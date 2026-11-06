const { randomUUID } = require("node:crypto");
function buildRestorePlan(data, sourceId, target, account, library, mode) {
  if (
    !data ||
    data.formatVersion !== 1 ||
    !Array.isArray(data.profiles) ||
    !data.profiles.some((p) => p.id === sourceId) ||
    !["merge", "replace-conflicts"].includes(mode) ||
    JSON.stringify(data).length > 5 * 1024 * 1024
  )
    throw Error("Choose a supported I/O account export and source profile");
  const plan = {
    targetId: target.id,
    mode,
    sourceName: String(data.profiles.find((p) => p.id === sourceId).name).slice(
      0,
      100,
    ),
    sourceAccount: String(data.account?.username || "").slice(0, 100),
    lists: [],
    favorites: [],
    video: [],
    manga: [],
    novels: [],
    watched: [],
    skipped: 0,
  };
  const rows = (name) => {
    const value = data[name] || [];
    if (!Array.isArray(value) || value.length > 20000)
      throw Error("Export contains too many records");
    return value.filter((r) => r && r.profile_id === sourceId);
  };
  const allowed = (type, id) => {
    const item =
      typeof id === "string" &&
      (type === "anime"
        ? library.getShow(id)
        : type === "manga"
          ? library.getManga(id)
          : null);
    return item &&
      (!(target.is_kids || account.adultContentAllowed === false) ||
        !/(rx|hentai|x-rated)/i.test(item.rating || ""))
      ? item
      : null;
  };
  const validEpisode = (show, path) =>
    typeof path === "string" &&
    (show.groups || []).some((g) => g.episodes.some((e) => e.relPath === path));
  for (const r of rows("my_list")) {
    if (
      allowed(r.item_type, r.item_id) &&
      ["planned", "in_progress", "completed", "dropped"].includes(r.status)
    )
      plan.lists.push({ id: r.item_id, type: r.item_type, status: r.status });
    else plan.skipped++;
  }
  for (const r of rows("top_picks")) {
    if (allowed(r.item_type, r.item_id))
      plan.favorites.push({ id: r.item_id, type: r.item_type });
    else plan.skipped++;
  }
  for (const r of rows("progress")) {
    const show = allowed("anime", r.item_id);
    if (
      show &&
      validEpisode(show, r.episode_rel_path) &&
      Number.isFinite(r.seconds) &&
      Number.isFinite(r.duration) &&
      r.seconds >= 0 &&
      r.duration >= r.seconds &&
      r.duration < 1e8
    )
      plan.video.push({
        id: r.item_id,
        episode: r.episode_rel_path,
        seconds: r.seconds,
        duration: r.duration,
        hidden: r.hidden === 1 ? 1 : 0,
      });
    else plan.skipped++;
  }
  for (const r of rows("manga_progress")) {
    const book = allowed("manga", r.manga_id),
      chapter = book?.chapters?.find((c) => c.name === r.chapter_name),
      total = chapter?.pageCount || r.total_pages;
    if (
      chapter &&
      Number.isInteger(r.page) &&
      r.page >= 1 &&
      Number.isInteger(total) &&
      total >= r.page &&
      total <= 1e6
    )
      plan.manga.push({
        id: r.manga_id,
        chapter: r.chapter_name,
        page: r.page,
        total,
      });
    else plan.skipped++;
  }
  for (const r of rows("watched_episodes")) {
    const show = allowed("anime", r.item_id);
    if (show && validEpisode(show, r.episode_rel_path))
      plan.watched.push({ id: r.item_id, episode: r.episode_rel_path });
    else plan.skipped++;
  }
  for (const r of rows("novel_progress")) {
    const book = allowed("manga", r.item_id),
      chapter = book?.chapters?.find((c) => c.name === r.chapter);
    if (
      chapter &&
      chapter.format === "novel" &&
      Number.isInteger(r.section) &&
      r.section >= 0 &&
      r.section < chapter.pageCount &&
      Number.isFinite(r.fraction) &&
      r.fraction >= 0 &&
      r.fraction <= 1
    )
      plan.novels.push({
        id: r.item_id,
        chapter: r.chapter,
        section: r.section,
        fraction: r.fraction,
      });
    else plan.skipped++;
  }
  const novel = rows("novel_preferences")[0];
  if (
    novel &&
    Number.isInteger(novel.size) &&
    novel.size >= 14 &&
    novel.size <= 36 &&
    Number.isFinite(novel.spacing) &&
    novel.spacing >= 1.3 &&
    novel.spacing <= 2.4 &&
    Number.isInteger(novel.width) &&
    novel.width >= 480 &&
    novel.width <= 1100 &&
    ["dark", "light", "sepia"].includes(novel.theme)
  )
    plan.novelPreferences = {
      size: novel.size,
      spacing: novel.spacing,
      width: novel.width,
      theme: novel.theme,
    };
  const reader = rows("reader_preferences")[0];
  if (
    reader &&
    ["single", "double", "webtoon"].includes(reader.layout) &&
    ["rtl", "ltr"].includes(reader.direction) &&
    ["screen", "width"].includes(reader.fit) &&
    Number.isInteger(reader.zoom) &&
    reader.zoom >= 50 &&
    reader.zoom <= 200
  )
    plan.reader = {
      layout: reader.layout,
      direction: reader.direction,
      fit: reader.fit,
      zoom: reader.zoom,
    };
  const experience = rows("experience_preferences")[0];
  if (experience) {
    try {
      const value = {
        ...require("./experience").defaults,
        ...JSON.parse(experience.value),
      };
      if (require("./experience").validate(value)) plan.experience = value;
    } catch {
      plan.skipped++;
    }
  }
  return plan;
}
function applyRestorePlan(db, plan) {
  const at = new Date().toISOString(),
    replace = plan.mode === "replace-conflicts",
    suffix = replace ? "DO UPDATE SET status=excluded.status" : "DO NOTHING";
  for (const r of plan.lists)
    db.prepare(
      `INSERT INTO my_list(profile_id,item_type,item_id,status) VALUES(?,?,?,?) ON CONFLICT(profile_id,item_type,item_id) ${suffix}`,
    ).run(plan.targetId, r.type, r.id, r.status);
  for (const r of plan.favorites)
    db.prepare(
      "INSERT OR IGNORE INTO top_picks(profile_id,item_type,item_id) VALUES(?,?,?)",
    ).run(plan.targetId, r.type, r.id);
  for (const r of plan.video)
    db.prepare(
      `INSERT INTO progress(profile_id,item_id,episode_rel_path,seconds,duration,updated_at,hidden) VALUES(?,?,?,?,?,?,?) ON CONFLICT(profile_id,item_id) ${replace ? "DO UPDATE SET episode_rel_path=excluded.episode_rel_path,seconds=excluded.seconds,duration=excluded.duration,updated_at=excluded.updated_at,hidden=excluded.hidden" : "DO NOTHING"}`,
    ).run(plan.targetId, r.id, r.episode, r.seconds, r.duration, at, r.hidden);
  for (const r of plan.manga)
    db.prepare(
      `INSERT INTO manga_progress VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,manga_id) ${replace ? "DO UPDATE SET chapter_name=excluded.chapter_name,page=excluded.page,total_pages=excluded.total_pages,updated_at=excluded.updated_at" : "DO NOTHING"}`,
    ).run(plan.targetId, r.id, r.chapter, r.page, r.total, at);
  for (const r of plan.watched)
    db.prepare(
      "INSERT OR IGNORE INTO watched_episodes(profile_id,item_id,item_type,episode_rel_path,episode_title,watched_at) VALUES(?,?,?,?,?,?)",
    ).run(plan.targetId, r.id, "anime", r.episode, "", at);
  for (const r of plan.novels || [])
    db.prepare(
      `INSERT INTO novel_progress VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,item_id,chapter) ${replace ? "DO UPDATE SET section=excluded.section,fraction=excluded.fraction,updated_at=excluded.updated_at" : "DO NOTHING"}`,
    ).run(plan.targetId, r.id, r.chapter, r.section, r.fraction, at);
  if (plan.novelPreferences)
    db.prepare(
      `INSERT INTO novel_preferences VALUES(?,?,?,?,?) ON CONFLICT(profile_id) ${replace ? "DO UPDATE SET size=excluded.size,spacing=excluded.spacing,width=excluded.width,theme=excluded.theme" : "DO NOTHING"}`,
    ).run(
      plan.targetId,
      ...["size", "spacing", "width", "theme"].map(
        (k) => plan.novelPreferences[k],
      ),
    );
  if (plan.reader)
    db.prepare(
      `INSERT INTO reader_preferences VALUES(?,?,?,?,?) ON CONFLICT(profile_id) ${replace ? "DO UPDATE SET layout=excluded.layout,direction=excluded.direction,fit=excluded.fit,zoom=excluded.zoom" : "DO NOTHING"}`,
    ).run(
      plan.targetId,
      ...["layout", "direction", "fit", "zoom"].map((k) => plan.reader[k]),
    );
  if (plan.experience)
    db.prepare(
      `INSERT INTO experience_preferences VALUES(?,?) ON CONFLICT(profile_id) ${replace ? "DO UPDATE SET value=excluded.value" : "DO NOTHING"}`,
    ).run(plan.targetId, JSON.stringify(plan.experience));
}
function registerAccountRestore(
  app,
  { db, requireAuth, accounts, getLibrary },
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS account_restore_plans(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,expires_at INTEGER NOT NULL)",
  );
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (!res.headersSent) res.status(400).json({ error: e.message });
      });
  async function owner(req, res) {
    const a = requireAuth(req, res);
    if (!a) return;
    const result = await accounts.verifyPassword({
      username: a.username,
      password: req.body?.password,
      totpCode: req.body?.totpCode,
    });
    if (result?.id !== a.id)
      throw Error("Confirm your password and two-factor code");
    return a;
  }
  app.post(
    "/api/account-data/restore/preview",
    safe(async (req, res) => {
      const a = await owner(req, res);
      if (!a) return;
      const b = req.body,
        p =
          typeof b.targetId === "string" &&
          db
            .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
            .get(b.targetId, a.id);
      if (!p) return res.sendStatus(403);
      const plan = buildRestorePlan(
          b.data,
          b.sourceId,
          p,
          a,
          getLibrary(),
          b.mode,
        ),
        id = randomUUID();
      db.prepare(
        "DELETE FROM account_restore_plans WHERE account_id=? OR expires_at<?",
      ).run(a.id, Date.now());
      db.prepare("INSERT INTO account_restore_plans VALUES(?,?,?,?)").run(
        id,
        a.id,
        JSON.stringify(plan),
        Date.now() + 300000,
      );
      res.json({
        id,
        targetName: p.name,
        sourceName: plan.sourceName,
        sourceAccount: plan.sourceAccount,
        mode: plan.mode,
        counts: Object.fromEntries(
          ["lists", "favorites", "video", "manga", "novels", "watched"].map(
            (k) => [k, plan[k].length],
          ),
        ),
        preferences: !!(
          plan.reader ||
          plan.experience ||
          plan.novelPreferences
        ),
        skipped: plan.skipped,
      });
    }),
  );
  app.post(
    "/api/account-data/restore/apply",
    safe(async (req, res) => {
      const a = await owner(req, res);
      if (!a) return;
      const row =
        typeof req.body.planId === "string" &&
        db
          .prepare(
            "SELECT * FROM account_restore_plans WHERE id=? AND account_id=? AND expires_at>?",
          )
          .get(req.body.planId, a.id, Date.now());
      if (!row) throw Error("Preview this restore again");
      const plan = JSON.parse(row.value),
        p = db
          .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
          .get(plan.targetId, a.id);
      if (!p) throw Error("Destination profile is no longer available");
      for (const key of [
        "lists",
        "favorites",
        "video",
        "manga",
        "novels",
        "watched",
      ])
        for (const r of plan[key] || []) {
          const type =
              r.type || (["manga", "novels"].includes(key) ? "manga" : "anime"),
            item =
              type === "manga"
                ? getLibrary().getManga(r.id)
                : getLibrary().getShow(r.id);
          if (!item) throw Error("Library changed; preview again");
          if (
            (p.is_kids || a.adultContentAllowed === false) &&
            /(rx|hentai|x-rated)/i.test(item.rating || "")
          )
            throw Error("Profile restrictions changed; preview again");
          if (
            ["video", "watched"].includes(key) &&
            !(item.groups || []).some((g) =>
              g.episodes.some((e) => e.relPath === r.episode),
            )
          )
            throw Error("Episodes changed; preview again");
          if (["manga", "novels"].includes(key)) {
            const c = item.chapters?.find((c) => c.name === r.chapter);
            if (
              !c ||
              (key === "novels" &&
                (c.format !== "novel" || r.section >= c.pageCount)) ||
              (key === "manga" && c.pageCount && r.page > c.pageCount)
            )
              throw Error("Book chapters changed; preview again");
          }
        }

      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM account_restore_plans WHERE id=?").run(row.id);
        applyRestorePlan(db, plan);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      res.json({ ok: true });
    }),
  );
}
module.exports = { buildRestorePlan, applyRestorePlan, registerAccountRestore };
