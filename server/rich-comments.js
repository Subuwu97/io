const sanitize = require("sanitize-html");
function richComment(value) {
  if (typeof value !== "string" || value.length > 16000)
    throw Error("Formatted comments must be smaller than 16,000 characters");
  const html = sanitize(value, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "s",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h2",
      "h3",
      "a",
    ],
    allowedAttributes: { a: ["href", "rel", "target"] },
    allowedSchemes: ["https", "http"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attrs) => ({
        tagName: tag,
        attribs: {
          href: attrs.href || "",
          rel: "nofollow noopener noreferrer",
          target: "_blank",
        },
      }),
    },
  });
  const text = sanitize(html, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
  if (!text || text.length > 2000)
    throw Error("Write between 1 and 2,000 characters");
  return { html, text };
}
function gifAttachment(value) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 2800000 ||
    !/^data:image\/gif;base64,[A-Za-z0-9+/]+=*$/.test(value)
  )
    throw Error("Choose a GIF smaller than 2 MB");
  const bytes = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
  if (
    bytes.length < 14 ||
    bytes.length > 2 * 1024 * 1024 ||
    !["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")) ||
    !bytes.readUInt16LE(6) ||
    !bytes.readUInt16LE(8) ||
    bytes.readUInt16LE(6) > 4096 ||
    bytes.readUInt16LE(8) > 4096 ||
    bytes.at(-1) !== 0x3b
  )
    throw Error("Choose a valid GIF up to 4096 × 4096 pixels");
  return bytes;
}
module.exports = { richComment, gifAttachment };
