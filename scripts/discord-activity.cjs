// Run on the computer where Discord Desktop is installed, even if the I/O server lives elsewhere.
const RPC = require("discord-rpc"),
  readline = require("node:readline/promises");
async function main() {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const address =
      process.env.IO_URL || (await prompt.question("I/O web address: ")),
    token =
      process.env.IO_ACTIVITY_KEY ||
      (await prompt.question(
        "Companion key from I/O settings (keep private): ",
      ));
  prompt.close();
  const url = new URL("/api/watch-activity/companion", address);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw Error("Use HTTPS, or localhost for testing");
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid companion key");
  let rpc = null,
    clientId = "",
    busy = false,
    stopping = false;
  const headers = { Authorization: "Bearer " + token };
  async function clear() {
    if (rpc) await rpc.clearActivity().catch(() => {});
  }
  async function poll() {
    if (busy || stopping) return;
    busy = true;
    try {
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 401) {
        await clear();
        throw Error("Companion key revoked. Generate a new key in I/O.");
      }
      if (!response.ok) throw Error("I/O is unavailable");
      const data = await response.json();
      if (!data.clientId)
        throw Error(
          "Set your Discord application client ID in I/O service settings",
        );
      if (!rpc || clientId !== data.clientId) {
        if (rpc) await rpc.destroy().catch(() => {});
        clientId = data.clientId;
        rpc = new RPC.Client({ transport: "ipc" });
        rpc.on("disconnected", () => {
          rpc = null;
        });
        await rpc.login({ clientId });
      }
      const a = data.activity;
      if (!a) {
        await clear();
        return;
      }
      await rpc.setActivity({
        details: a.title.slice(0, 128),
        state: ("Watching · " + a.episode).slice(0, 128),
        startTimestamp: new Date(Date.now() - a.position * 1000),
        ...(a.duration > a.position
          ? {
              endTimestamp: new Date(
                Date.now() + (a.duration - a.position) * 1000,
              ),
            }
          : {}),
        instance: false,
      });
    } catch (error) {
      await clear();
      console.error(
        error.message.includes("revoked")
          ? error.message
          : "Activity unavailable. Check I/O settings, the server connection and Discord Desktop. Retrying…",
      );
    } finally {
      busy = false;
    }
  }
  await poll();
  const timer = setInterval(poll, 10000);
  async function stop() {
    stopping = true;
    clearInterval(timer);
    await clear();
    if (rpc) await rpc.destroy().catch(() => {});
    process.exit(0);
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
