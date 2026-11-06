// EPUB is just a zip container with an OPF manifest/spine describing
// reading order. Manga-style EPUBs are almost always one full-page image
// per XHTML spine entry, so rather than rendering XHTML/CSS we just walk
// the spine in order and pull out the first image each page references -
// giving the same "list of page images" shape as a folder of images or a
// CBZ, so the rest of the app doesn't need to know the difference.
const path = require("path");
const archive = require("./archive");

function getAttr(tag, attrName) {
  const m = tag.match(new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function resolvePath(baseDir, relPath) {
  // Normalize "a/b/../c.jpg" style relative paths against the OPF/XHTML's
  // own directory inside the zip, since zip entry names are always
  // forward-slash paths regardless of host OS.
  const parts = (baseDir ? baseDir.split("/") : []).concat(relPath.split("/"));
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// Returns an ordered array of image entry names (paths inside the zip)
// representing the reading order, or [] if it can't figure it out (caller
// should fall back to a natural sort of every image in the archive).
function resolvePageOrder(zipBuffer, imageExtensions) {
  const entries = archive.readZipEntries(zipBuffer);

  const containerEntry = entries.find(
    (e) => e.name === "META-INF/container.xml",
  );
  if (!containerEntry) return [];
  const containerXml = archive
    .extractEntry(zipBuffer, containerEntry)
    .toString("utf8");
  const rootfileMatch = containerXml.match(
    /<rootfile[^>]*full-path\s*=\s*"([^"]+)"/i,
  );
  if (!rootfileMatch) return [];
  const opfPath = rootfileMatch[1];
  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/"))
    : "";

  const opfEntry = entries.find((e) => e.name === opfPath);
  if (!opfEntry) return [];
  const opfXml = archive.extractEntry(zipBuffer, opfEntry).toString("utf8");

  // Manifest: id -> href (resolved to a zip-root-relative path)
  const manifest = {};
  const itemTagRe = /<item\b[^>]*\/?>/gi;
  let m;
  while ((m = itemTagRe.exec(opfXml))) {
    const tag = m[0];
    const id = getAttr(tag, "id");
    const href = getAttr(tag, "href");
    if (id && href)
      manifest[id] = resolvePath(opfDir, decodeURIComponent(href));
  }

  // Spine: ordered list of manifest ids
  const spineIds = [];
  const itemrefRe = /<itemref\b[^>]*\/?>/gi;
  while ((m = itemrefRe.exec(opfXml))) {
    const idref = getAttr(m[0], "idref");
    if (idref) spineIds.push(idref);
  }
  if (spineIds.length === 0) return [];

  const pages = [];
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;
    const ext = path.extname(href).toLowerCase();
    if (imageExtensions.includes(ext)) {
      // Spine sometimes points straight at an image (image-only EPUBs).
      pages.push(href);
      continue;
    }
    // Otherwise it's an XHTML page - pull out its first <img src="...">.
    const xhtmlEntry = entries.find((e) => e.name === href);
    if (!xhtmlEntry) continue;
    const xhtml = archive.extractEntry(zipBuffer, xhtmlEntry).toString("utf8");
    const imgMatch =
      xhtml.match(/<img\b[^>]*src\s*=\s*"([^"]+)"/i) ||
      xhtml.match(/<image\b[^>]*(?:xlink:href|href)\s*=\s*"([^"]+)"/i);
    if (imgMatch) {
      const xhtmlDir = href.includes("/")
        ? href.slice(0, href.lastIndexOf("/"))
        : "";
      pages.push(resolvePath(xhtmlDir, decodeURIComponent(imgMatch[1])));
    }
  }
  return pages;
}

function resolveTextSpine(zipBuffer, force = false) {
  const entries = archive.readZipEntries(zipBuffer);
  if (entries.length > 10000) throw Error("EPUB contains too many entries");
  const read = (name) => {
    const e = entries.find((e) => e.name === name);
    return e
      ? archive.extractEntry(zipBuffer, e, 2 * 1024 * 1024).toString("utf8")
      : "";
  };
  const attr = (tag, name) => {
    const m = tag.match(
      new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"),
    );
    return m?.[2] || "";
  };
  const container = read("META-INF/container.xml"),
    root = (container.match(/<rootfile\b[^>]*>/i) || [])[0],
    opfPath = root && attr(root, "full-path");
  if (!opfPath) return [];
  const opf = read(opfPath),
    base = path.posix.dirname(opfPath),
    manifest = new Map();
  for (const tag of opf.match(/<item\b[^>]*>/gi) || []) {
    const id = attr(tag, "id"),
      href = attr(tag, "href");
    if (id && href && !/^[a-z]+:|^\/\//i.test(href)) {
      const name = resolvePath(base, decodeURIComponent(href.split("#")[0]));
      if (/\.(xhtml|html|htm)$/i.test(name)) manifest.set(id, name);
    }
  }
  const sections = [];
  let richSections = 0;
  for (const tag of opf.match(/<itemref\b[^>]*>/gi) || []) {
    if (attr(tag, "linear") === "no") continue;
    const name = manifest.get(attr(tag, "idref"));
    if (!name) continue;
    const html = read(name);
    const body =
      (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || html;
    const letters = body
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s/g, "").length;
    if (letters > 200) richSections++;
    const heading = (html.match(
      /<(?:h1|h2|title)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|title)>/i,
    ) || [])[1];
    sections.push({
      name,
      title: heading
        ? heading
            .replace(/<[^>]+>/g, "")
            .trim()
            .slice(0, 160)
        : "Section " + (sections.length + 1),
    });
    if (sections.length > 1000) throw Error("EPUB has too many sections");
  }
  return force || richSections >= Math.max(1, Math.ceil(sections.length * 0.25))
    ? sections
    : [];
}
module.exports = { resolvePageOrder, resolveTextSpine };
