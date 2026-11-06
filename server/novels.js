const fs = require("node:fs/promises"),
  path = require("node:path"),
  archive = require("./archive"),
  epub = require("./epub"),
  sanitize = require("sanitize-html");
function sanitizeSection(html, sectionPath, assetPrefix, entries) {
  return sanitize(html, {
    nonTextTags: ["script", "style", "textarea", "option", "head", "title"],
    allowedTags: [
      "p",
      "div",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "em",
      "strong",
      "b",
      "i",
      "u",
      "s",
      "br",
      "hr",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "figure",
      "figcaption",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "ruby",
      "rt",
      "rp",
      "sup",
      "sub",
    ],
    allowedAttributes: { img: ["src", "alt"], ol: ["start"] },
    allowedSchemes: [],
    allowProtocolRelative: false,
    transformTags: {
      img: (tag, attrs) => {
        let name = "";
        try {
          const raw = decodeURIComponent(attrs.src || "");
          if (!/^[a-z]+:|^\//i.test(raw))
            name = path.posix.normalize(
              path.posix.join(
                path.posix.dirname(sectionPath),
                raw.split("#")[0],
              ),
            );
        } catch {}
        return {
          tagName: "img",
          attribs:
            entries.some((e) => e.name === name) &&
            /\.(png|jpe?g|gif|webp)$/i.test(name)
              ? {
                  src:
                    assetPrefix +
                    name.split("/").map(encodeURIComponent).join("/"),
                  alt: (attrs.alt || "").slice(0, 200),
                }
              : { alt: "" },
        };
      },
    },
  });
}
function registerNovels(
  app,
  { db, requireAuth, getLibrary, publicOrigin = () => "" },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS novel_progress(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,item_id TEXT NOT NULL,chapter TEXT NOT NULL,section INTEGER NOT NULL,fraction REAL NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(profile_id,item_id,chapter));CREATE TABLE IF NOT EXISTS novel_preferences(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,size INTEGER NOT NULL,spacing REAL NOT NULL,width INTEGER NOT NULL,theme TEXT NOT NULL);`,
  );
  const cache = new Map();
  app.use("/api/novels", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      !new Set([`${req.protocol}://${req.get("host")}`, publicOrigin()]).has(
        req.headers.origin,
      )
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  });
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent) res.status(400).json({ error: e.message });
      });
  async function context(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const profileId =
        req.method === "GET" ? req.query.profile : req.body?.profileId,
      p =
        typeof profileId === "string" &&
        db
          .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
          .get(profileId, a.id),
      lib = getLibrary(),
      book = lib.getManga(req.params.id),
      chapter = book && lib.getChapterInfo(book.id, req.params.chapter);
    if (
      !p ||
      !book ||
      !chapter ||
      chapter.type !== "novel" ||
      ((p.is_kids || a.adultContentAllowed === false) &&
        /(rx|hentai|x-rated)/i.test(book.rating || ""))
    ) {
      res.status(404).json({ error: "Novel not available to this profile" });
      return;
    }
    const stat = await fs.stat(chapter.fullPath);
    if (stat.size > 32 * 1024 * 1024)
      throw Error("Text EPUBs must be smaller than 32 MB");
    const key = chapter.fullPath + ":" + stat.mtimeMs;
    let parsed = cache.get(key);
    if (!parsed) {
      const bytes = await fs.readFile(chapter.fullPath),
        entries = archive.readZipEntries(bytes),
        sections = epub.resolveTextSpine(bytes, true);
      parsed = { bytes, entries, sections };
      cache.set(key, parsed);
      while (
        [...cache.values()].reduce((n, x) => n + x.bytes.length, 0) >
          64 * 1024 * 1024 ||
        cache.size > 8
      )
        cache.delete(cache.keys().next().value);
    }
    return { p, book, ...parsed };
  }
  const defaults = { size: 20, spacing: 1.8, width: 760, theme: "dark" };
  app.get(
    "/api/novels/:id/:chapter",
    safe(async (req, res) => {
      const c = await context(req, res);
      if (!c) return;
      res.json({
        title: c.book.title,
        sections: c.sections.map((s, i) => ({ index: i, title: s.title })),
        progress: db
          .prepare(
            "SELECT section,fraction FROM novel_progress WHERE profile_id=? AND item_id=? AND chapter=?",
          )
          .get(c.p.id, c.book.id, req.params.chapter) || {
          section: 0,
          fraction: 0,
        },
        preferences:
          db
            .prepare(
              "SELECT size,spacing,width,theme FROM novel_preferences WHERE profile_id=?",
            )
            .get(c.p.id) || defaults,
      });
    }),
  );
  app.get(
    "/api/novels/:id/:chapter/section/:section",
    safe(async (req, res) => {
      const c = await context(req, res);
      if (!c) return;
      const index = Number(req.params.section);
      if (!Number.isInteger(index) || !c.sections[index])
        return res.sendStatus(404);
      const section = c.sections[index],
        entry = c.entries.find((e) => e.name === section.name),
        html = archive
          .extractEntry(c.bytes, entry, 2 * 1024 * 1024)
          .toString("utf8"),
        prefix =
          "/api/novels/" +
          encodeURIComponent(c.book.id) +
          "/" +
          encodeURIComponent(req.params.chapter) +
          "/asset/";
      const clean = sanitizeSection(
        html,
        section.name,
        prefix,
        c.entries,
      ).replace(
        /src="([^"]+)"/g,
        (match, url) =>
          'src="' + url + "?profile=" + encodeURIComponent(c.p.id) + '"',
      );
      res.json({ html: clean, index });
    }),
  );
  app.get(
    "/api/novels/:id/:chapter/asset/*",
    safe(async (req, res) => {
      const c = await context(req, res);
      if (!c) return;
      const name = req.params[0],
        entry = c.entries.find((e) => e.name === name);
      if (!entry || !/\.(png|jpe?g|gif|webp)$/i.test(name))
        return res.sendStatus(404);
      const bytes = archive.extractEntry(c.bytes, entry, 8 * 1024 * 1024);
      res
        .set("X-Content-Type-Options", "nosniff")
        .type(path.extname(name))
        .send(bytes);
    }),
  );
  app.put(
    "/api/novels/:id/:chapter/progress",
    safe(async (req, res) => {
      const c = await context(req, res);
      if (!c) return;
      const { section, fraction, preferences } = req.body;
      if (
        !Number.isInteger(section) ||
        !c.sections[section] ||
        !Number.isFinite(fraction) ||
        fraction < 0 ||
        fraction > 1
      )
        return res.sendStatus(400);
      if (
        preferences &&
        (!Number.isInteger(preferences.size) ||
          preferences.size < 14 ||
          preferences.size > 36 ||
          !Number.isFinite(preferences.spacing) ||
          preferences.spacing < 1.3 ||
          preferences.spacing > 2.4 ||
          !Number.isInteger(preferences.width) ||
          preferences.width < 480 ||
          preferences.width > 1100 ||
          !["dark", "light", "sepia"].includes(preferences.theme))
      )
        return res.sendStatus(400);
      db.prepare(
        "INSERT INTO novel_progress VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,item_id,chapter) DO UPDATE SET section=excluded.section,fraction=excluded.fraction,updated_at=excluded.updated_at",
      ).run(
        c.p.id,
        c.book.id,
        req.params.chapter,
        section,
        fraction,
        new Date().toISOString(),
      );
      if (preferences)
        db.prepare(
          "INSERT INTO novel_preferences VALUES(?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET size=excluded.size,spacing=excluded.spacing,width=excluded.width,theme=excluded.theme",
        ).run(
          c.p.id,
          preferences.size,
          preferences.spacing,
          preferences.width,
          preferences.theme,
        );
      res.json({ ok: true });
    }),
  );
}
module.exports = { registerNovels, sanitizeSection };
