const { randomBytes, createHash } = require("node:crypto");
const webauthn = require("@simplewebauthn/server");
const hash = (v) => createHash("sha256").update(v).digest("hex");
function registerPasskeys(
  app,
  {
    db,
    requireAuth,
    accounts,
    services,
    setSessionCookie,
    implementation = webauthn,
    now = Date.now,
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,public_key BLOB NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL,last_used TEXT);
  CREATE TABLE IF NOT EXISTS passkey_challenges(hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,challenge TEXT NOT NULL,origin TEXT NOT NULL,rp_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  const limits = new Map();
  function rate(req) {
    const key = req.ip,
      clock = now(),
      r = limits.get(key);
    if (r && clock - r.at < 60000) {
      if (++r.n > 30) throw Error("Please wait before trying again");
    } else limits.set(key, { at: clock, n: 1 });
    if (limits.size > 5000) limits.delete(limits.keys().next().value);
  }
  const safe = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => {
        rate(req);
        return fn(req, res);
      })
      .catch((e) => {
        if (!res.headersSent)
          res
            .status(400)
            .json({ error: e.message || "Passkey request failed" });
      });
  function origin(req) {
    const configured = services.get().publicUrl;
    if (configured) return new URL(configured);
    const url = new URL(`${req.protocol}://${req.get("host")}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw Error(
        "The administrator must set an HTTPS public address before enabling passkeys",
      );
    return url;
  }
  app.use(["/api/passkeys", "/api/auth/passkeys"], (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.headers.origin) {
      try {
        if (req.headers.origin !== origin(req).origin)
          return res
            .status(403)
            .json({ error: "Request origin is not allowed" });
      } catch {
        return res
          .status(403)
          .json({ error: "Passkeys require HTTPS or localhost" });
      }
    }
    next();
  });
  async function proof(req, a) {
    const result = await accounts.verifyPassword({
      username: a.username,
      password: req.body?.password,
      totpCode: req.body?.totpCode,
    });
    if (result?.id !== a.id)
      throw Error("Confirm your password and two-factor code, if enabled");
  }
  function issue(res, kind, a, options, url) {
    const token = randomBytes(32).toString("hex");
    db.prepare(
      "DELETE FROM passkey_challenges WHERE expires_at<? OR account_id=?",
    ).run(now(), a?.id || "");
    db.prepare("INSERT INTO passkey_challenges VALUES(?,?,?,?,?,?,?)").run(
      hash(token),
      a?.id || null,
      kind,
      options.challenge,
      url.origin,
      url.hostname,
      now() + 300000,
    );
    res.append(
      "Set-Cookie",
      `io_passkey=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=300${url.protocol === "https:" ? "; Secure" : ""}`,
    );
    return options;
  }
  function consume(req, kind) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("io_passkey="))
      ?.slice(11);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw Error("Start the passkey request again");
    const row = db
      .prepare(
        "DELETE FROM passkey_challenges WHERE hash=? AND kind=? AND expires_at>? RETURNING *",
      )
      .get(hash(token), kind, now());
    if (!row) throw Error("Passkey request expired or was already used");
    if (origin(req).origin !== row.origin)
      throw Error("Passkey address changed; start again");
    return row;
  }
  app.get("/api/passkeys", (req, res) => {
    const a = requireAuth(req, res);
    if (a)
      res.json(
        db
          .prepare(
            "SELECT id,name,created_at AS createdAt,last_used AS lastUsed FROM passkeys WHERE account_id=?",
          )
          .all(a.id),
      );
  });
  app.post(
    "/api/passkeys/register/options",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      await proof(req, a);
      const existing = db
        .prepare("SELECT id FROM passkeys WHERE account_id=?")
        .all(a.id);
      if (existing.length >= 10)
        throw Error("Remove a passkey before adding another");
      const url = origin(req),
        options = await implementation.generateRegistrationOptions({
          rpName: "I/O",
          rpID: url.hostname,
          userID: Buffer.from(a.id),
          userName: a.username,
          attestationType: "none",
          excludeCredentials: existing,
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
          },
        });
      res.json(issue(res, "register", a, options, url));
    }),
  );
  app.post(
    "/api/passkeys/register/verify",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      const c = consume(req, "register");
      if (c.account_id !== a.id)
        throw Error("Passkey request belongs to another account");
      const result = await implementation.verifyRegistrationResponse({
        response: req.body.response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origin,
        expectedRPID: c.rp_id,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo)
        throw Error("Passkey verification failed");
      const credential = result.registrationInfo.credential,
        name =
          typeof req.body.name === "string"
            ? req.body.name.trim().slice(0, 80)
            : "Passkey";
      db.prepare("INSERT INTO passkeys VALUES(?,?,?,?,?,?,?,NULL)").run(
        credential.id,
        a.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports || []),
        name || "Passkey",
        new Date(now()).toISOString(),
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/passkeys/remove",
    safe(async (req, res) => {
      const a = requireAuth(req, res);
      if (!a) return;
      await proof(req, a);
      if (typeof req.body.id !== "string") throw Error("Choose a passkey");
      db.prepare("DELETE FROM passkeys WHERE id=? AND account_id=?").run(
        req.body.id,
        a.id,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/auth/passkeys/options",
    safe(async (req, res) => {
      const url = origin(req);
      res.json(
        issue(
          res,
          "login",
          null,
          await implementation.generateAuthenticationOptions({
            rpID: url.hostname,
            userVerification: "required",
          }),
          url,
        ),
      );
    }),
  );
  app.post(
    "/api/auth/passkeys/verify",
    safe(async (req, res) => {
      const c = consume(req, "login"),
        response = req.body?.response;
      if (typeof response?.id !== "string")
        throw Error("Invalid passkey response");
      const key = db
          .prepare("SELECT * FROM passkeys WHERE id=?")
          .get(response.id),
        a = key && accounts.getAccount(key.account_id);
      if (!key || !a || !a.approved) throw Error("Passkey sign-in unavailable");
      if (
        response.response?.userHandle &&
        Buffer.from(response.response.userHandle, "base64url").toString() !==
          a.id
      )
        throw Error("Passkey account does not match");
      const result = await implementation.verifyAuthenticationResponse({
        response,
        expectedChallenge: c.challenge,
        expectedOrigin: c.origin,
        expectedRPID: c.rp_id,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(key.public_key),
          counter: key.counter,
          transports: JSON.parse(key.transports),
        },
        requireUserVerification: true,
      });
      if (!result.verified) throw Error("Passkey verification failed");
      if (
        !db
          .prepare(
            "UPDATE passkeys SET counter=?,last_used=? WHERE id=? AND counter=?",
          )
          .run(
            result.authenticationInfo.newCounter,
            new Date(now()).toISOString(),
            key.id,
            key.counter,
          ).changes
      )
        throw Error("Passkey state changed; sign in again");
      setSessionCookie(
        res,
        accounts.createSession(a.id, req.headers["user-agent"]),
      );
      res.json({ account: a });
    }),
  );
}
module.exports = { registerPasskeys };
