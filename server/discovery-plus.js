const { randomUUID } = require("node:crypto");
function registerDiscoveryPlus(
  app,
  { db, requireAuth, getLibrary, publicOrigin = () => "" },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS upcoming_titles(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL,release_at TEXT NOT NULL,rating TEXT NOT NULL);CREATE TABLE IF NOT EXISTS book_details(item_id TEXT PRIMARY KEY,value TEXT NOT NULL);`,
  );
  app.use("/api/discovery-plus", (req, res, next) => {
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
  const releases = require("./upcoming-sync").registerUpcomingSync(app, {
    db,
    requireAuth,
  });
  const admin = (req, res) => {
    const a = requireAuth(req, res);
    if (a && a.role !== "admin") {
      res.sendStatus(403);
      return null;
    }
    return a;
  };
  app.get("/api/discovery-plus", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const library = getLibrary(),
      rows = db
        .prepare(
          "SELECT item_id,COUNT(DISTINCT profile_id) viewers,COUNT(*) completions FROM watched_episodes WHERE watched_at>=? GROUP BY item_id ORDER BY viewers DESC,completions DESC,item_id",
        )
        .all(new Date(Date.now() - 30 * 86400000).toISOString());
    const rank = (items) =>
      rows
        .filter((r) => items.some((s) => s.id === r.item_id))
        .slice(0, 10)
        .map((r, i) => ({ id: r.item_id, rank: i + 1 }));
    res.set("Cache-Control", "no-store").json({
      series: rank(library.cache.anime),
      movies: rank(library.cache.movies),
      upcoming: db
        .prepare(
          "SELECT * FROM upcoming_titles WHERE release_at>=? ORDER BY release_at,id LIMIT 200",
        )
        .all(new Date(Date.now() - 86400000).toISOString())
        .concat(releases.items())
        .sort((a, b) => a.release_at.localeCompare(b.release_at)),
      rankingPeriod: "30 days",
    });
  });
  app.post("/api/discovery-plus/upcoming", (req, res) => {
    if (!admin(req, res)) return;
    const b = req.body || {};
    if (
      typeof b.title !== "string" ||
      !b.title.trim() ||
      b.title.length > 200 ||
      typeof b.description !== "string" ||
      b.description.length > 2000 ||
      !["series", "movie", "manga"].includes(b.kind) ||
      typeof b.rating !== "string" ||
      b.rating.length > 30 ||
      typeof b.releaseAt !== "string" ||
      !Number.isFinite(Date.parse(b.releaseAt))
    )
      return res
        .status(400)
        .json({ error: "Check title, format and release date" });
    const id = randomUUID();
    db.prepare("INSERT INTO upcoming_titles VALUES(?,?,?,?,?,?)").run(
      id,
      b.title.trim(),
      b.description,
      b.kind,
      new Date(b.releaseAt).toISOString(),
      b.rating,
    );
    res.status(201).json({ id });
  });
  app.delete("/api/discovery-plus/upcoming/:id", (req, res) => {
    if (!admin(req, res)) return;
    db.prepare("DELETE FROM upcoming_titles WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/discovery-plus/books/:id", (req, res) => {
    if (!requireAuth(req, res)) return;
    const book = getLibrary().getManga(req.params.id);
    if (!book) return res.sendStatus(404);
    const row = db
      .prepare("SELECT value FROM book_details WHERE item_id=?")
      .get(book.id);
    res.json(
      row
        ? JSON.parse(row.value)
        : {
            author: book.author || "",
            artist: book.artist || "",
            publisher: book.publisher || "",
            publicationStatus: book.publicationStatus || "",
            language: book.language || "",
            volumes: book.volumes || [],
          },
    );
  });
  app.put("/api/discovery-plus/books/:id", (req, res) => {
    if (!admin(req, res)) return;
    const book = getLibrary().getManga(req.params.id),
      b = req.body || {};
    if (!book) return res.sendStatus(404);
    if (
      ["author", "artist", "publisher", "publicationStatus", "language"].some(
        (k) => typeof b[k] !== "string" || b[k].length > 200,
      ) ||
      !Array.isArray(b.volumes) ||
      b.volumes.length > 200 ||
      b.volumes.some(
        (v) =>
          typeof v.name !== "string" ||
          !v.name.trim() ||
          v.name.length > 100 ||
          !Array.isArray(v.chapters) ||
          v.chapters.some(
            (c) =>
              typeof c !== "string" || !book.chapters.some((x) => x.name === c),
          ),
      )
    )
      return res
        .status(400)
        .json({ error: "Check book details and volume chapter names" });
    const names = b.volumes.flatMap((v) => v.chapters);
    if (new Set(names).size !== names.length)
      return res
        .status(400)
        .json({ error: "A chapter can only belong to one volume" });
    const value = Object.fromEntries(
      [
        "author",
        "artist",
        "publisher",
        "publicationStatus",
        "language",
        "volumes",
      ].map((k) => [k, b[k]]),
    );
    db.prepare(
      "INSERT INTO book_details VALUES(?,?) ON CONFLICT(item_id) DO UPDATE SET value=excluded.value",
    ).run(book.id, JSON.stringify(value));
    res.json(value);
  });
}
module.exports = { registerDiscoveryPlus };
