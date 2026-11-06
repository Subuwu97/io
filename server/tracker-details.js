const { randomUUID } = require("node:crypto");
const states = [
  "planned",
  "current",
  "completed",
  "paused",
  "dropped",
  "repeating",
];
const stateMap = {
  watching: "current",
  reading: "current",
  completed: "completed",
  on_hold: "paused",
  dropped: "dropped",
  plan_to_watch: "planned",
  plan_to_read: "planned",
  CURRENT: "current",
  COMPLETED: "completed",
  PAUSED: "paused",
  DROPPED: "dropped",
  PLANNING: "planned",
  REPEATING: "repeating",
};
function date(value) {
  if (value === "") return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "2200-12-31" ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw Error(
      "Use a complete date in YYYY-MM-DD format, or leave it blank to clear it",
    );
  return value;
}
function validatePatch(name, body) {
  const fields = body.fields;
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    fields.length > 4 ||
    new Set(fields).size !== fields.length ||
    fields.some((k) => !["state", "score", "dates", "repeat"].includes(k))
  )
    throw Error("Choose the fields to change");
  const patch = {};
  if (fields.includes("state")) {
    if (!states.includes(body.state)) throw Error("Choose a tracker state");
    patch.state = body.state;
  }
  if (fields.includes("score")) {
    if (
      !Number.isInteger(body.score) ||
      body.score < 0 ||
      body.score > (name === "mal" ? 10 : 100)
    )
      throw Error(
        "Score must be a whole number from 0 to " + (name === "mal" ? 10 : 100),
      );
    patch.score = body.score;
  }
  if (fields.includes("repeat")) {
    if (!Number.isInteger(body.repeat) || body.repeat < 0 || body.repeat > 1000)
      throw Error("Repeat count must be from 0 to 1,000");
    patch.repeat = body.repeat;
  }
  if (fields.includes("dates")) {
    patch.startedAt = date(body.startedAt);
    patch.completedAt = date(body.completedAt);
    if (
      patch.startedAt &&
      patch.completedAt &&
      patch.startedAt > patch.completedAt
    )
      throw Error("Completion date must be on or after the start date");
  }
  return patch;
}
const fuzzy = (s) =>
  s
    ? Object.fromEntries(
        ["year", "month", "day"].map((k, i) => [k, Number(s.split("-")[i])]),
      )
    : { year: null, month: null, day: null };
const textDate = (d) =>
  d && (d.year || d.month || d.day)
    ? [
        String(d.year || 0).padStart(4, "0"),
        String(d.month || 0).padStart(2, "0"),
        String(d.day || 0).padStart(2, "0"),
      ].join("-")
    : "";
function createDetailProvider({ json, graph }) {
  async function read(token, name, title, type) {
    const id = Number(title[name === "mal" ? "malId" : "anilistId"]);
    if (name === "mal") {
      const data = await json(
          `https://api.myanimelist.net/v2/${type}/${id}?fields=my_list_status`,
          { headers: { Authorization: "Bearer " + token.access_token } },
        ),
        s = data.my_list_status || {};
      return {
        state:
          s.is_rewatching || s.is_rereading
            ? "repeating"
            : stateMap[s.status] || (s.status ? "unknown" : "planned"),
        score: s.score || 0,
        startedAt: s.start_date || "",
        completedAt: s.finish_date || "",
        repeat:
          s[type === "manga" ? "num_times_reread" : "num_times_rewatched"] || 0,
      };
    }
    const data = await graph(
        token.access_token,
        "query($id:Int!){Media(id:$id){mediaListEntry{status score(format:POINT_100) repeat startedAt{year month day} completedAt{year month day}}}}",
        { id },
      ),
      s = data.data.Media?.mediaListEntry || {};
    return {
      state: stateMap[s.status] || (s.status ? "unknown" : "planned"),
      score: s.score || 0,
      startedAt: textDate(s.startedAt),
      completedAt: textDate(s.completedAt),
      repeat: s.repeat || 0,
    };
  }
  async function write(token, name, title, type, patch) {
    const id = Number(title[name === "mal" ? "malId" : "anilistId"]);
    if (name === "mal") {
      const values = {};
      if (patch.state !== undefined) {
        values.status = {
          planned: type === "manga" ? "plan_to_read" : "plan_to_watch",
          current: type === "manga" ? "reading" : "watching",
          completed: "completed",
          paused: "on_hold",
          dropped: "dropped",
          repeating: type === "manga" ? "reading" : "watching",
        }[patch.state];
        values[type === "manga" ? "is_rereading" : "is_rewatching"] = String(
          patch.state === "repeating",
        );
      }
      if (patch.score !== undefined) values.score = String(patch.score);
      if (patch.repeat !== undefined)
        values[type === "manga" ? "num_times_reread" : "num_times_rewatched"] =
          String(patch.repeat);
      if (patch.startedAt !== undefined) {
        values.start_date = patch.startedAt;
        values.finish_date = patch.completedAt;
      }
      await json(
        `https://api.myanimelist.net/v2/${type}/${id}/my_list_status`,
        {
          method: "PATCH",
          headers: {
            Authorization: "Bearer " + token.access_token,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(values).toString(),
        },
      );
      return;
    }
    const args = { id },
      definitions = ["$id:Int!"],
      assignments = ["mediaId:$id"];
    for (const [field, apiField, typeName, value] of [
      [
        "state",
        "status",
        "MediaListStatus",
        {
          planned: "PLANNING",
          current: "CURRENT",
          completed: "COMPLETED",
          paused: "PAUSED",
          dropped: "DROPPED",
          repeating: "REPEATING",
        }[patch.state],
      ],
      ["score", "scoreRaw", "Int", patch.score],
      ["repeat", "repeat", "Int", patch.repeat],
      ["startedAt", "startedAt", "FuzzyDateInput", fuzzy(patch.startedAt)],
      [
        "completedAt",
        "completedAt",
        "FuzzyDateInput",
        fuzzy(patch.completedAt),
      ],
    ])
      if (patch[field] !== undefined) {
        args[apiField] = value;
        definitions.push("$" + apiField + ":" + typeName);
        assignments.push(apiField + ":$" + apiField);
      }
    await graph(
      token.access_token,
      `mutation(${definitions.join(",")}){SaveMediaListEntry(${assignments.join(",")}){id}}`,
      args,
    );
  }
  return { read, write };
}
function registerTrackerDetails(
  app,
  {
    db,
    requireAuth,
    credential,
    getLibrary,
    json,
    graph,
    locks,
    now = Date.now,
  },
) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS tracker_title_details(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,provider TEXT NOT NULL,item_type TEXT NOT NULL,item_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(profile_id,provider,item_type,item_id));CREATE TABLE IF NOT EXISTS tracker_detail_plans(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,value TEXT NOT NULL,expires_at INTEGER NOT NULL);`,
  );
  const provider = createDetailProvider({ json, graph }),
    safe = (fn) => (req, res) =>
      Promise.resolve()
        .then(() => fn(req, res))
        .catch((e) => {
          if (!res.headersSent) res.status(400).json({ error: e.message });
        });
  function context(req, res, body) {
    const a = requireAuth(req, res);
    if (!a) return;
    if (a.approved === false) throw Error("Account approval is required");
    const p = db
        .prepare("SELECT * FROM profiles WHERE id=? AND account_id=?")
        .get(req.params.id, a.id),
      name = req.params.provider,
      type = body.itemType,
      title =
        type === "anime"
          ? getLibrary().getShow(body.itemId)
          : type === "manga"
            ? getLibrary().getManga(body.itemId)
            : null;
    if (!p) {
      res.sendStatus(403);
      return;
    }
    if (
      !["mal", "anilist"].includes(name) ||
      !title ||
      !Number.isSafeInteger(
        Number(title[name === "mal" ? "malId" : "anilistId"]),
      ) ||
      Number(title[name === "mal" ? "malId" : "anilistId"]) < 1
    )
      throw Error("Choose a title with a valid tracker ID");
    if (
      (p.is_kids || a.adultContentAllowed === false) &&
      /(rx|hentai|x-rated)/i.test(title.rating || "")
    )
      throw Error("Title is not available to this profile");
    return { a, p, name, type, title };
  }
  const local = (c) =>
    db
      .prepare(
        "SELECT value FROM tracker_title_details WHERE profile_id=? AND provider=? AND item_type=? AND item_id=?",
      )
      .get(c.p.id, c.name, c.type, c.title.id)?.value || null;
  app.post(
    "/api/trackers/:id/:provider/details/read",
    safe(async (req, res) => {
      const c = context(req, res, req.body || {});
      if (!c) return;
      const token = await credential(c.p.id, c.name);
      res.json({
        remote: await provider.read(token, c.name, c.title, c.type),
        local: JSON.parse(local(c) || "null"),
      });
    }),
  );
  app.post(
    "/api/trackers/:id/:provider/details/preview",
    safe(async (req, res) => {
      const b = req.body || {},
        c = context(req, res, b);
      if (!c) return;
      if (!["push", "pull"].includes(b.direction))
        throw Error("Choose a sync direction");
      const patch = b.direction === "push" ? validatePatch(c.name, b) : null,
        token = await credential(c.p.id, c.name),
        before = await provider.read(token, c.name, c.title, c.type),
        id = randomUUID(),
        plan = {
          profileId: c.p.id,
          name: c.name,
          type: c.type,
          itemId: c.title.id,
          trackerId: Number(c.title[c.name === "mal" ? "malId" : "anilistId"]),
          subject: token.subject,
          direction: b.direction,
          beforeLocal: local(c),
          beforeRemote: before,
          patch,
        };
      db.prepare(
        "DELETE FROM tracker_detail_plans WHERE account_id=? OR expires_at<?",
      ).run(c.a.id, now());
      db.prepare("INSERT INTO tracker_detail_plans VALUES(?,?,?,?)").run(
        id,
        c.a.id,
        JSON.stringify(plan),
        now() + 300000,
      );
      res.json({
        id,
        title: c.title.title,
        direction: b.direction,
        before: before,
        after: b.direction === "push" ? { ...before, ...patch } : before,
        fields:
          b.direction === "push"
            ? Object.keys(patch)
            : ["local tracker details"],
      });
    }),
  );
  app.post(
    "/api/trackers/:id/:provider/details/apply",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const row =
        typeof req.body?.planId === "string" &&
        db
          .prepare(
            "SELECT * FROM tracker_detail_plans WHERE id=? AND account_id=? AND expires_at>?",
          )
          .get(req.body.planId, a.id, now());
      if (!row) throw Error("Preview the tracker details again");
      const plan = JSON.parse(row.value);
      if (plan.profileId !== req.params.id || plan.name !== req.params.provider)
        throw Error("Preview belongs to another profile");
      const key = plan.profileId + ":" + plan.name;
      if (locks.has(key)) throw Error("A sync is already in progress");
      locks.add(key);
      try {
        db.prepare("DELETE FROM tracker_detail_plans WHERE id=?").run(row.id);
        const c = context(req, res, {
          itemType: plan.type,
          itemId: plan.itemId,
        });
        if (!c) return;
        const token = await credential(c.p.id, c.name),
          sealed = db
            .prepare(
              "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
            )
            .get(c.p.id, c.name)?.credentials,
          r = await provider.read(token, c.name, c.title, c.type);
        if (
          Number(c.title[c.name === "mal" ? "malId" : "anilistId"]) !==
            plan.trackerId ||
          token.subject !== plan.subject ||
          local(c) !== plan.beforeLocal ||
          JSON.stringify(r) !== JSON.stringify(plan.beforeRemote)
        )
          throw Error("Tracker details changed; review a fresh preview");
        const current = context(req, res, {
          itemType: plan.type,
          itemId: plan.itemId,
        });
        if (!current) return;
        if (
          Number(current.title[c.name === "mal" ? "malId" : "anilistId"]) !==
          plan.trackerId
        )
          throw Error("Title mapping changed; preview again");
        if (
          db
            .prepare(
              "SELECT credentials FROM tracker_connections WHERE profile_id=? AND provider=?",
            )
            .get(c.p.id, c.name)?.credentials !== sealed
        )
          throw Error("Tracker authorization changed");
        if (plan.direction === "push")
          await provider.write(token, c.name, c.title, c.type, plan.patch);
        const value = plan.direction === "push" ? { ...r, ...plan.patch } : r;
        db.prepare(
          "INSERT INTO tracker_title_details VALUES(?,?,?,?,?) ON CONFLICT(profile_id,provider,item_type,item_id) DO UPDATE SET value=excluded.value",
        ).run(c.p.id, c.name, c.type, c.title.id, JSON.stringify(value));
        res.json({ ok: true, details: value });
      } finally {
        locks.delete(key);
      }
    }),
  );
}
module.exports = {
  registerTrackerDetails,
  createDetailProvider,
  validatePatch,
};
