const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const { registerHeroEntry } = require("../server/hero-entry");
test("custom banners require admin writes, reject foreign origins and SVG, and hide disabled entries", async () => {
  const app = express(),
    db = new DatabaseSync(":memory:");
  app.use(express.json());
  const auth = (req, res) =>
    req.headers.authorization
      ? { id: "a" }
      : (res.status(401).json({ error: "Sign in" }), null);
  registerHeroEntry(app, {
    db,
    requireAuth: auth,
    requireAdmin: (req, res) =>
      req.headers.authorization === "admin"
        ? { id: "a" }
        : (res.status(403).json({ error: "Admin only" }), null),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const entry = {
    enabled: true,
    position: 3,
    title: "Welcome",
    description: "Custom announcement",
    image:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=",
  };
  const put = (body, authorization = "admin", origin = url) =>
    fetch(url + "/api/home-hero/manage", {
      method: "PUT",
      headers: { authorization, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(url + "/api/home-hero")).status, 401);
    assert.equal((await put(entry, "member")).status, 403);
    assert.equal(
      (await put(entry, "admin", "https://foreign.example")).status,
      403,
    );
    assert.equal(
      (await put({ ...entry, image: "data:image/svg+xml;base64,PHN2Zz4=" }))
        .status,
      400,
    );
    assert.equal((await put({ ...entry, position: 7 })).status, 400);
    assert.equal((await put(entry)).status, 200);
    assert.deepEqual(
      await (
        await fetch(url + "/api/home-hero", {
          headers: { authorization: "member" },
        })
      ).json(),
      entry,
    );
    assert.equal((await put({ ...entry, enabled: false })).status, 200);
    assert.equal(
      await (
        await fetch(url + "/api/home-hero", {
          headers: { authorization: "member" },
        })
      ).json(),
      null,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
