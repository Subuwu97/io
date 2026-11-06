function validateEntry(b) {
  if (
    !b ||
    typeof b.enabled !== "boolean" ||
    !Number.isInteger(b.position) ||
    b.position < 1 ||
    b.position > 6
  )
    throw Error("Choose a position from 1 to 6");
  if (
    typeof b.title !== "string" ||
    b.title.length > 100 ||
    typeof b.description !== "string" ||
    b.description.length > 400
  )
    throw Error("Title or description is too long");
  if (typeof b.image !== "string" || b.image.length > 2800000)
    throw Error("Choose a PNG or JPEG under 2 MB");
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    b.image,
  );
  const bytes = match && Buffer.from(match[2], "base64");
  if (
    !bytes ||
    bytes.length > 2 * 1024 * 1024 ||
    (match[1] === "png"
      ? bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      : bytes.subarray(0, 3).toString("hex") !== "ffd8ff")
  )
    throw Error("Choose a valid PNG or JPEG under 2 MB");
  return {
    enabled: b.enabled,
    position: b.position,
    title: b.title.trim(),
    description: b.description.trim(),
    image: b.image,
  };
}
function registerHeroEntry(
  app,
  { db, requireAuth, requireAdmin, publicOrigin = () => "" },
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS home_hero_entry(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)",
  );
  const read = () => {
    const row = db
      .prepare("SELECT value FROM home_hero_entry WHERE id=1")
      .get();
    return row ? JSON.parse(row.value) : null;
  };
  app.get("/api/home-hero", (req, res) => {
    if (!requireAuth(req, res)) return;
    res.set("Cache-Control", "no-store");
    const value = read();
    res.json(value?.enabled ? value : null);
  });
  app.get("/api/home-hero/manage", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.set("Cache-Control", "no-store");
    res.json(read());
  });
  app.put("/api/home-hero/manage", (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (
      req.headers.origin &&
      !new Set([`${req.protocol}://${req.get("host")}`, publicOrigin()]).has(
        req.headers.origin,
      )
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    try {
      const value = validateEntry(req.body);
      db.prepare(
        "INSERT INTO home_hero_entry(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      ).run(JSON.stringify(value));
      res.json(value);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
module.exports = { registerHeroEntry, validateEntry };
