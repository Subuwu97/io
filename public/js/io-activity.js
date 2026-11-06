async function ioPageActivity(root) {
  const route = location.hash,
    p = Store.activeProfile,
    data = await API._fetch("/api/watch-activity/" + p.id + "/settings");
  if (route !== location.hash) return;
  root.innerHTML = ioSettingsShell(
    "Discord watch activity",
    `<section class="io-settings-card"><h2>Share what you are watching</h2><p>Off by default. When enabled, I/O can send this profile’s current non-mature title and episode to a companion running beside Discord Desktop. Activity stops while paused or shortly after playback closes. Kids profiles cannot enable it.</p><label class="io-checkbox-row"><input type="checkbox" id="ioActivityEnabled" ${data.enabled ? "checked" : ""} ${p.isKids ? "disabled" : ""}>Share this profile’s watch activity</label><button class="btn btn-primary" id="ioActivitySave">Save activity choice</button><h3>Desktop companion</h3><p>On the computer running Discord Desktop, open the I/O source folder and run <code>node scripts/discord-activity.cjs</code>. Enter your I/O address and a companion key below. The key only reads this profile’s watch activity. Generating a new key revokes the previous one; disabling sharing revokes it too.</p><p>${data.clientId ? "Discord application ID configured." : "Set your own Discord application client ID in Email & sign-in setup first. Sign-in itself does not need to be enabled."}</p><button class="btn btn-secondary" id="ioActivityKey" ${data.enabled ? "" : "disabled"}>Generate companion key</button><div id="ioActivitySecret"></div><p id="ioActivityStatus" role="status"></p></section>`,
    "activity",
  );
  wireNavbar();
  const status = root.querySelector("#ioActivityStatus");
  root.querySelector("#ioActivitySave").onclick = async () => {
    try {
      await ioJSON("/api/watch-activity/" + p.id + "/settings", "PUT", {
        enabled: root.querySelector("#ioActivityEnabled").checked,
      });
      await ioPageActivity(root);
      showToast("Watch activity preference saved");
    } catch (error) {
      status.textContent = error.message;
    }
  };
  root.querySelector("#ioActivityKey").onclick = async () => {
    try {
      const { token } = await ioJSON(
        "/api/watch-activity/" + p.id + "/companion-key",
        "POST",
        {},
      );
      const area = root.querySelector("#ioActivitySecret");
      area.innerHTML =
        '<label>Companion key — shown once<input readonly type="password" aria-label="Companion key"></label><button class="btn btn-secondary" type="button">Show key</button>';
      area.querySelector("input").value = token;
      area.querySelector("button").onclick = () => {
        const input = area.querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
      };
    } catch (error) {
      status.textContent = error.message;
    }
  };
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = (active) =>
    nav(active).replace(
      "</nav>",
      '<a href="#/watch-activity">Discord watch activity</a></nav>',
    );
  const player = window.pagePlayer;
  window.pagePlayer = async function (root, id, episode) {
    await player(root, id, episode);
    const video = root.querySelector("video"),
      profile = Store.activeProfile;
    if (!video || !profile) return;
    let busy = false;
    async function send() {
      if (busy || !video.isConnected) return;
      busy = true;
      try {
        await ioJSON(
          "/api/watch-activity/" + profile.id + "/heartbeat",
          "POST",
          {
            itemId: id,
            episode: decodeURIComponent(episode),
            position:
              Number(video.dataset.ioAbsoluteTime) || video.currentTime || 0,
            duration:
              Number(video.dataset.ioDuration) ||
              (Number.isFinite(video.duration) ? video.duration : 0),
            paused: video.paused,
          },
        );
      } catch {
      } finally {
        busy = false;
      }
    }
    const timer = setInterval(send, 10000);
    video.addEventListener("play", send);
    video.addEventListener("pause", send);
    window.addEventListener("hashchange", () => clearInterval(timer), {
      once: true,
    });
  };
})();
