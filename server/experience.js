const defaults = {
  interfaceLanguage: "en",
  titleLanguage: "default",
  quality: "auto",
  blurMature: true,
  showIntro: true,
  showOutro: true,
  subtitleFont: "sans-serif",
  subtitleScale: 100,
  subtitleOpacity: 100,
  subtitleBackgroundOpacity: 80,
  subtitleEffect: "outline",
  preferredAudio: "",
  preferredSubtitles: "",
  onboardingDone: false,
  genres: [],
  avoidGenres: [],
};
function validate(b) {
  return (
    b &&
    ["en", "es", "fr", "ja"].includes(b.interfaceLanguage) &&
    ["default", "english", "romaji", "native"].includes(b.titleLanguage) &&
    ["auto", "original", "1080", "720", "480", "360", "240"].includes(
      b.quality,
    ) &&
    ["blurMature", "showIntro", "showOutro", "onboardingDone"].every(
      (k) => typeof b[k] === "boolean",
    ) &&
    ["sans-serif", "serif", "monospace"].includes(b.subtitleFont) &&
    ["outline", "shadow", "none"].includes(b.subtitleEffect) &&
    [
      ["subtitleScale", 50, 200],
      ["subtitleOpacity", 10, 100],
      ["subtitleBackgroundOpacity", 0, 100],
    ].every(
      ([k, min, max]) => Number.isInteger(b[k]) && b[k] >= min && b[k] <= max,
    ) &&
    ["preferredAudio", "preferredSubtitles"].every(
      (k) => typeof b[k] === "string" && /^[a-z]{0,3}$/.test(b[k]),
    ) &&
    ["genres", "avoidGenres"].every(
      (k) =>
        Array.isArray(b[k]) &&
        b[k].length <= 20 &&
        b[k].every(
          (g) => typeof g === "string" && g.length > 0 && g.length <= 60,
        ),
    )
  );
}
function registerExperience(app, { db, requireAuth, publicOrigin = () => "" }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS experience_preferences(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,value TEXT NOT NULL)",
  );
  app.use("/api/experience", (req, res, next) => {
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
  function own(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const p = db
      .prepare("SELECT id FROM profiles WHERE id=? AND account_id=?")
      .get(req.params.id, a.id);
    if (!p) res.status(403).json({ error: "Profile not available" });
    return p;
  }
  app.get("/api/experience/:id", (req, res) => {
    if (!own(req, res)) return;
    const row = db
      .prepare("SELECT value FROM experience_preferences WHERE profile_id=?")
      .get(req.params.id);
    res.json({ ...defaults, ...(row ? JSON.parse(row.value) : {}) });
  });
  app.put("/api/experience/:id", (req, res) => {
    if (!own(req, res)) return;
    if (!validate(req.body))
      return res.status(400).json({ error: "Invalid experience preferences" });
    const value = Object.fromEntries(
      Object.keys(defaults).map((k) => [k, req.body[k]]),
    );
    db.prepare(
      "INSERT INTO experience_preferences VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET value=excluded.value",
    ).run(req.params.id, JSON.stringify(value));
    res.json(value);
  });
}
module.exports = { registerExperience, defaults, validate };
