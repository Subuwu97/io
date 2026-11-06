const sections = ["list", "favorites", "reviews", "statistics", "social"];
const mature = (item) =>
  /(rx|hentai|x-rated|^r\+|^r -|^r$|nc-17|18\+)/i.test(item?.rating || "");
function registerPublicProfiles(
  app,
  { db, requireAuth, getLibrary, publicOrigin = () => "" },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS public_profiles(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,slug TEXT NOT NULL UNIQUE COLLATE NOCASE,visibility TEXT NOT NULL DEFAULT 'private',discoverable INTEGER NOT NULL DEFAULT 0,bio TEXT NOT NULL DEFAULT '',privacy TEXT NOT NULL DEFAULT '{}',characters TEXT NOT NULL DEFAULT '[]',links TEXT NOT NULL DEFAULT '[]');`,
  );
  const defaults = {
    list: false,
    favorites: false,
    reviews: false,
    statistics: false,
    social: false,
  };
  const relations = require("./relationships").createRelationships(db);
  app.use("/api/people", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin &&
      !new Set([`${req.protocol}://${req.get("host")}`, publicOrigin()]).has(
        req.headers.origin,
      )
    )
      return res.status(403).json({ error: "Request origin is not allowed" });
    next();
  });
  relations.register(app, { requireAuth });
  function owned(req, res, a) {
    if (!a) return;
    const p = db
      .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
      .get(req.params.id, a.id);
    if (!p) res.status(403).json({ error: "Profile not available" });
    return p;
  }
  app.get("/api/people/settings/:id", (req, res) => {
    const a = requireAuth(req, res),
      p = owned(req, res, a);
    if (!p) return;
    const row = db
      .prepare("SELECT * FROM public_profiles WHERE profile_id=?")
      .get(p.id);
    res.json(
      row
        ? {
            slug: row.slug,
            visibility: row.visibility,
            discoverable: !!row.discoverable,
            bio: row.bio,
            privacy: { ...defaults, ...JSON.parse(row.privacy) },
            characters: JSON.parse(row.characters),
            links: JSON.parse(row.links),
          }
        : {
            slug: "",
            visibility: "private",
            discoverable: false,
            bio: "",
            privacy: defaults,
            characters: [],
            links: [],
          },
    );
  });
  app.put("/api/people/settings/:id", (req, res) => {
    const a = requireAuth(req, res),
      p = owned(req, res, a);
    if (!p) return;
    const b = req.body || {};
    if (
      typeof b.slug !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/.test(b.slug) ||
      !["private", "unlisted", "public", "friends"].includes(b.visibility) ||
      typeof b.discoverable !== "boolean" ||
      typeof b.bio !== "string" ||
      b.bio.length > 1000 ||
      !b.privacy ||
      sections.some(
        (s) =>
          typeof b.privacy[s] !== "boolean" &&
          !["private", "members", "followers", "friends"].includes(
            b.privacy[s],
          ),
      ) ||
      !Array.isArray(b.characters) ||
      b.characters.length > 12 ||
      b.characters.some((c) => typeof c !== "string" || c.length > 100) ||
      !Array.isArray(b.links) ||
      b.links.length > 5
    )
      return res
        .status(400)
        .json({ error: "Check your username, visibility and profile details" });
    if (p.is_kids && (b.visibility !== "private" || b.discoverable))
      return res
        .status(400)
        .json({ error: "Kids profiles must remain private" });
    const links = [];
    for (const link of b.links) {
      try {
        if (
          typeof link.label !== "string" ||
          !link.label.trim() ||
          link.label.length > 50 ||
          typeof link.url !== "string" ||
          link.url.length > 500
        )
          throw Error();
        const url = new URL(link.url);
        if (url.protocol !== "https:" || url.username || url.password)
          throw Error();
        links.push({ label: link.label.trim(), url: url.href });
      } catch {
        return res
          .status(400)
          .json({ error: "Social links need a label and an HTTPS address" });
      }
    }
    const existing = db
      .prepare(
        "SELECT profile_id FROM public_profiles WHERE slug=? COLLATE NOCASE",
      )
      .get(b.slug);
    if (existing && existing.profile_id !== p.id)
      return res
        .status(409)
        .json({ error: "That public username is already taken" });
    db.prepare(
      `INSERT INTO public_profiles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET slug=excluded.slug,visibility=excluded.visibility,discoverable=excluded.discoverable,bio=excluded.bio,privacy=excluded.privacy,characters=excluded.characters,links=excluded.links`,
    ).run(
      p.id,
      b.slug.toLowerCase(),
      b.visibility,
      b.visibility === "public" && b.discoverable ? 1 : 0,
      b.bio.trim(),
      JSON.stringify(
        Object.fromEntries(sections.map((s) => [s, b.privacy[s]])),
      ),
      JSON.stringify(b.characters.map((c) => c.trim()).filter(Boolean)),
      JSON.stringify(links),
    );
    res.json({ ok: true });
  });
  const card = (r) => ({
    slug: r.slug,
    name: r.name,
    avatar:
      typeof r.avatar === "string" && /^\/img\/avatars\/[\w.-]+$/.test(r.avatar)
        ? r.avatar
        : "/img/avatars/avatar1.svg",
    bio: r.bio,
  });
  app.get("/api/people", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const q =
        typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "",
      page = Math.max(0, Math.min(10000, parseInt(req.query.page) || 0));
    const rows = db
      .prepare(
        `SELECT u.*,p.name,p.avatar FROM public_profiles u JOIN profiles p ON p.id=u.profile_id JOIN accounts a ON a.id=p.account_id WHERE u.visibility='public' AND u.discoverable=1 AND p.is_kids=0 AND a.approved=1 AND NOT EXISTS(SELECT 1 FROM account_blocks b WHERE (b.source=? AND b.target=p.account_id) OR (b.source=p.account_id AND b.target=?)) AND (instr(lower(u.slug),lower(?))>0 OR instr(lower(p.name),lower(?))>0) ORDER BY u.slug COLLATE NOCASE LIMIT 25 OFFSET ?`,
      )
      .all(a.id, a.id, q, q, page * 24);
    res.json({
      items: rows.slice(0, 24).map(card),
      hasMore: rows.length > 24,
      page,
    });
  });
  app.get("/api/people/u/:slug", (req, res) => {
    const a = requireAuth(req, res);
    if (!a) return;
    const row = db
      .prepare(
        `SELECT u.*,p.name,p.avatar,p.account_id,p.is_kids,p.watched_seconds FROM public_profiles u JOIN profiles p ON p.id=u.profile_id JOIN accounts a ON a.id=p.account_id WHERE u.slug=? COLLATE NOCASE AND a.approved=1`,
      )
      .get(req.params.slug);
    const owner = row?.account_id === a.id;
    if (
      !row ||
      (!owner && relations.blocked(a.id, row.account_id)) ||
      ((row.visibility === "private" || row.is_kids) && !owner)
    )
      return res.status(404).json({ error: "Public profile not found" });
    const out = { ...card(row), owner, visibility: row.visibility },
      privacy = JSON.parse(row.privacy),
      library = getLibrary();
    const viewerId = relations.viewer(req, a);
    out.relationship = relations.state(viewerId, row.profile_id);
    const allowed = (section) =>
      (row.visibility !== "friends" ||
        owner ||
        relations.friend(viewerId, row.profile_id)) &&
      relations.audience(privacy[section], owner, viewerId, row.profile_id);
    // A public profile is a separate allowlisted projection, never a hydrated household profile.
    const title = (type, id) => {
      const item =
        type === "manga" ? library.getManga(id) : library.getShow(id);
      return item && !mature(item)
        ? { id: item.id, type, title: item.title, cover: item.cover || null }
        : null;
    };
    if (allowed("list"))
      out.list = db
        .prepare(
          "SELECT item_type,item_id,status FROM my_list WHERE profile_id=?",
        )
        .all(row.profile_id)
        .map((r) => {
          const t = title(r.item_type, r.item_id);
          return t ? { ...t, status: r.status } : null;
        })
        .filter(Boolean);
    if (allowed("favorites"))
      out.favorites = {
        titles: db
          .prepare("SELECT item_type,item_id FROM top_picks WHERE profile_id=?")
          .all(row.profile_id)
          .map((r) => title(r.item_type, r.item_id))
          .filter(Boolean),
        characters: JSON.parse(row.characters),
      };
    if (allowed("reviews"))
      out.reviews = db
        .prepare(
          "SELECT item_type,item_id,rating,text,created_at FROM reviews WHERE profile_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(row.profile_id)
        .map((r) => {
          const t = title(r.item_type, r.item_id);
          return t
            ? { ...t, rating: r.rating, text: r.text, createdAt: r.created_at }
            : null;
        })
        .filter(Boolean);
    if (allowed("statistics"))
      out.statistics = {
        watchedHours: Math.floor((row.watched_seconds || 0) / 3600),
        completedTitles: db
          .prepare(
            "SELECT item_type,item_id FROM my_list WHERE profile_id=? AND status='completed'",
          )
          .all(row.profile_id)
          .filter((r) => title(r.item_type, r.item_id)).length,
      };
    if (allowed("social")) out.links = JSON.parse(row.links);
    res.json(out);
  });
}
module.exports = { registerPublicProfiles };
