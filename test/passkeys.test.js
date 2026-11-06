const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  express = require("express"),
  { DatabaseSync } = require("node:sqlite");
const { registerPasskeys } = require("../server/passkeys");
test("real WebAuthn verification accepts an ES256 registration and assertion, rejects tampering and the wrong origin", async () => {
  const crypto = require("node:crypto"),
    { encodeCBOR } = require("@levischuck/tiny-cbor"),
    web = require("@simplewebauthn/server"),
    origin = "https://io.example",
    rpID = "io.example",
    id = crypto.randomBytes(24),
    keys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
    jwk = keys.publicKey.export({ format: "jwk" }),
    cose = encodeCBOR(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
      ]),
    ),
    rpHash = crypto.createHash("sha256").update(rpID).digest(),
    counter = Buffer.alloc(4),
    length = Buffer.alloc(2);
  length.writeUInt16BE(id.length);
  const opts = await web.generateRegistrationOptions({
      rpName: "I/O",
      rpID,
      userName: "Alice",
      userID: Buffer.from("a"),
    }),
    client = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: opts.challenge,
        origin,
        crossOrigin: false,
      }),
    ),
    auth = Buffer.concat([
      rpHash,
      Buffer.from([0x45]),
      counter,
      Buffer.alloc(16),
      length,
      id,
      Buffer.from(cose),
    ]),
    att = encodeCBOR(
      new Map([
        ["fmt", "none"],
        ["authData", new Uint8Array(auth)],
        ["attStmt", new Map()],
      ]),
    ),
    response = {
      id: id.toString("base64url"),
      rawId: id.toString("base64url"),
      type: "public-key",
      response: {
        clientDataJSON: client.toString("base64url"),
        attestationObject: Buffer.from(att).toString("base64url"),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  const registration = await web.verifyRegistrationResponse({
    response,
    expectedChallenge: opts.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  assert.equal(registration.verified, true);
  const login = await web.generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    }),
    loginClient = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: login.challenge,
        origin,
        crossOrigin: false,
      }),
    ),
    loginAuth = Buffer.concat([
      rpHash,
      Buffer.from([0x05]),
      Buffer.from([0, 0, 0, 1]),
    ]),
    signature = crypto.sign(
      "sha256",
      Buffer.concat([
        loginAuth,
        crypto.createHash("sha256").update(loginClient).digest(),
      ]),
      keys.privateKey,
    ),
    assertion = {
      id: response.id,
      rawId: response.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        authenticatorData: loginAuth.toString("base64url"),
        clientDataJSON: loginClient.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: Buffer.from("a").toString("base64url"),
      },
    },
    verification = {
      response: assertion,
      expectedChallenge: login.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: registration.registrationInfo.credential,
      requireUserVerification: true,
    };
  assert.equal(
    (await web.verifyAuthenticationResponse(verification)).verified,
    true,
  );
  await assert.rejects(() =>
    web.verifyAuthenticationResponse({
      ...verification,
      expectedOrigin: "https://evil.example",
    }),
  );
  const damaged = {
    ...assertion,
    response: {
      ...assertion.response,
      signature: Buffer.alloc(signature.length).toString("base64url"),
    },
  };
  let invalid;
  try {
    invalid = await web.verifyAuthenticationResponse({
      ...verification,
      response: damaged,
    });
  } catch {}
  assert.notEqual(invalid?.verified, true);
});
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys=ON;CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('a'),('b');",
  );
  let clock = Date.now(),
    approved = true,
    verified = true,
    calls = [];
  const app = express();
  app.use(express.json());
  const account = (id) => ({ id, username: id, approved });
  registerPasskeys(app, {
    db,
    requireAuth: (req, res) => {
      if (!req.headers["x-user"]) {
        res.sendStatus(401);
        return null;
      }
      return account(req.headers["x-user"]);
    },
    accounts: {
      verifyPassword: async (p) =>
        p.password === "correct" ? account(p.username) : null,
      getAccount: account,
      createSession: (id) => "session-" + id,
    },
    services: { get: () => ({ publicUrl: "https://io.example" }) },
    setSessionCookie: (res, token) => res.set("X-Test-Session", token),
    now: () => clock,
    implementation: {
      generateRegistrationOptions: async () => ({
        challenge: "register-challenge",
      }),
      generateAuthenticationOptions: async () => ({
        challenge: "login-challenge",
      }),
      verifyRegistrationResponse: async (opts) => {
        calls.push(opts);
        return {
          verified,
          registrationInfo: {
            credential: {
              id: "key-id",
              publicKey: new Uint8Array([1, 2]),
              counter: 0,
            },
          },
        };
      },
      verifyAuthenticationResponse: async (opts) => {
        calls.push(opts);
        return { verified, authenticationInfo: { newCounter: 1 } };
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const request = (
    path,
    body = {},
    user,
    cookie,
    origin = "https://io.example",
  ) =>
    fetch("http://127.0.0.1:" + server.address().port + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(user ? { "x-user": user } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  return {
    db,
    request,
    calls,
    advance: () => (clock += 300001),
    setApproved: (value) => (approved = value),
    setVerified: (value) => (verified = value),
  };
}
test("passkey enrollment requires proof, binds account and browser, expires and cannot be replayed", async (t) => {
  const f = await fixture(t),
    base = "/api/passkeys/register/";
  assert.equal((await f.request(base + "options", {}, "a")).status, 400);
  assert.equal(
    (
      await f.request(
        base + "options",
        { password: "correct" },
        "a",
        null,
        "https://evil.example",
      )
    ).status,
    403,
  );
  let r = await f.request(base + "options", { password: "correct" }, "a"),
    cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await f.request(base + "verify", { response: {} }, "b", cookie)).status,
    400,
  );
  assert.equal(
    (await f.request(base + "verify", { response: {} }, "a", cookie)).status,
    400,
  );
  r = await f.request(base + "options", { password: "correct" }, "a");
  cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await f.request(
        base + "verify",
        { response: {}, name: "Phone" },
        "a",
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(f.calls[0].requireUserVerification, true);
  assert.equal(f.calls[0].expectedOrigin, "https://io.example");
  assert.equal(
    (
      await f.request(
        "/api/passkeys/remove",
        { password: "correct", id: "key-id" },
        "b",
      )
    ).status,
    200,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM passkeys").get().n, 1);
  r = await f.request(base + "options", { password: "correct" }, "a");
  cookie = r.headers.get("set-cookie").split(";")[0];
  f.advance();
  assert.equal(
    (await f.request(base + "verify", { response: {} }, "a", cookie)).status,
    400,
  );
});
test("passkey authentication rejects failed verification, unapproved accounts and replay, updates counter on success", async (t) => {
  const f = await fixture(t);
  f.db
    .prepare("INSERT INTO passkeys VALUES(?,?,?,?,?,?,?,NULL)")
    .run("key-id", "a", Buffer.from([1, 2]), 0, "[]", "Phone", "today");
  async function login() {
    const r = await f.request("/api/auth/passkeys/options");
    return r.headers.get("set-cookie").split(";")[0];
  }
  let cookie = await login();
  f.setVerified(false);
  assert.equal(
    (
      await f.request(
        "/api/auth/passkeys/verify",
        { response: { id: "key-id", response: {} } },
        null,
        cookie,
      )
    ).status,
    400,
  );
  f.setVerified(true);
  f.setApproved(false);
  cookie = await login();
  assert.equal(
    (
      await f.request(
        "/api/auth/passkeys/verify",
        { response: { id: "key-id", response: {} } },
        null,
        cookie,
      )
    ).status,
    400,
  );
  f.setApproved(true);
  cookie = await login();
  const body = {
    response: {
      id: "key-id",
      response: { userHandle: Buffer.from("a").toString("base64url") },
    },
  };
  const r = await f.request("/api/auth/passkeys/verify", body, null, cookie);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-test-session"), "session-a");
  assert.equal(f.db.prepare("SELECT counter FROM passkeys").get().counter, 1);
  assert.equal(
    (await f.request("/api/auth/passkeys/verify", body, null, cookie)).status,
    400,
  );
});
