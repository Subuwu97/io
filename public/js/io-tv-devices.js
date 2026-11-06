function ioTVStored() {
  try {
    return JSON.parse(sessionStorage.getItem("ioTVDevice") || "null");
  } catch {
    return null;
  }
}
function ioTVStart() {
  if (window.ioTVTimer) clearInterval(window.ioTVTimer);
  const device = ioTVStored();
  if (!device || device.accountId !== Store.account?.id) return;
  let busy = false;
  async function beat() {
    if (busy || !Store.account) return;
    busy = true;
    try {
      const video = document.querySelector("video"),
        state = {
          title: video
            ? (
                document.querySelector("#playerTop .show-title")?.textContent ||
                document.title
              ).slice(0, 200)
            : "Browsing I/O",
          paused: video?.paused ?? true,
          position:
            Number(video?.dataset.ioAbsoluteTime) ||
            (Number.isFinite(video?.currentTime) ? video.currentTime : 0),
          duration:
            Number(video?.dataset.ioDuration) ||
            (Number.isFinite(video?.duration) ? video.duration : 0),
          volume: video?.volume ?? 1,
        };
      const response = await ioJSON(
        "/api/tv-devices/" + device.id + "/heartbeat",
        "POST",
        { token: device.token, state },
      );
      for (const item of response.commands) {
        if (!video) continue;
        if (item.command === "play")
          await video
            .play()
            .catch(() =>
              showToast("Press Play on this TV once to allow playback"),
            );
        if (item.command === "pause") video.pause();
        if (item.command === "volume") video.volume = item.value;
        if (["seek", "back", "forward"].includes(item.command)) {
          video.dispatchEvent(
            new CustomEvent("io-remote-command", { detail: item }),
          );
        }
      }
    } catch (error) {
      if (/not found|not registered|sign.in/i.test(error.message)) {
        clearInterval(window.ioTVTimer);
        sessionStorage.removeItem("ioTVDevice");
      }
    } finally {
      busy = false;
    }
  }
  beat();
  window.ioTVTimer = setInterval(beat, 2500);
}
async function ioPageTVDevices(root) {
  root.innerHTML = ioSettingsShell(
    "TV devices & remote",
    `<section class="io-settings-card"><h2>Register this TV browser</h2><p>Open this page on your TV and sign in to your I/O account. Register that browser, then use this page on your phone with the same account to control playback. Registration stays active in that TV tab until it closes. You may need to press Play on the TV once.</p><form id="ioRegisterTV"><label>Device name<input name="name" maxlength="80" required placeholder="Living room TV"></label><button class="btn btn-primary">Register this browser</button></form><p role="status" id="ioTVStatus"></p></section><section class="io-settings-card"><h2>Your registered devices</h2><button class="btn btn-secondary" id="ioTVRefresh">Refresh</button><div id="ioTVList"></div></section>`,
    "tv-devices",
  );
  wireNavbar();
  const list = root.querySelector("#ioTVList"),
    status = root.querySelector("#ioTVStatus");
  async function load() {
    try {
      const devices = await API._fetch("/api/tv-devices");
      if (!list.isConnected) return;
      list.innerHTML = devices.length
        ? devices
            .map(
              (d) =>
                `<article class="io-tv-device" data-device="${escapeHtml(d.id)}"><h3>${escapeHtml(d.name)} · ${d.online ? "Online" : "Offline"}</h3><p>${escapeHtml(d.state.title || "No activity")} · ${Math.floor(d.state.position || 0)} seconds</p><div class="io-dialog-actions">${[
                  ["back", "−10 sec"],
                  ["play", "Play"],
                  ["pause", "Pause"],
                  ["forward", "+10 sec"],
                ]
                  .map(
                    ([k, l]) =>
                      `<button class="btn btn-secondary" data-tv-command="${k}" ${d.online ? "" : "disabled"}>${l}</button>`,
                  )
                  .join(
                    "",
                  )}<button class="btn-ghost" data-tv-remove>Unregister</button></div><label>Volume<input type="range" min="0" max="1" step="0.05" value="${d.state.volume ?? 1}" data-tv-volume ${d.online ? "" : "disabled"}></label></article>`,
            )
            .join("")
        : "<p>No registered TVs yet.</p>";
    } catch (error) {
      status.textContent = error.message;
    }
  }
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const device = await ioJSON("/api/tv-devices", "POST", {
        name: new FormData(e.target).get("name"),
      });
      sessionStorage.setItem(
        "ioTVDevice",
        JSON.stringify({ ...device, accountId: Store.account.id }),
      );
      ioTVStart();
      status.textContent =
        "This browser is registered. Start a video here, then control it from another device.";
      await load();
    } catch (error) {
      status.textContent = error.message;
    }
  };
  root.querySelector("#ioTVRefresh").onclick = load;
  list.onclick = async (e) => {
    const button = e.target.closest("[data-tv-command],[data-tv-remove]");
    if (!button) return;
    const id = button.closest("[data-device]").dataset.device;
    try {
      if (button.hasAttribute("data-tv-remove")) {
        await API._fetch("/api/tv-devices/" + id, { method: "DELETE" });
        if (ioTVStored()?.id === id) {
          sessionStorage.removeItem("ioTVDevice");
          clearInterval(window.ioTVTimer);
        }
        await load();
      } else {
        await ioJSON("/api/tv-devices/" + id + "/command", "POST", {
          command: button.dataset.tvCommand,
        });
        status.textContent = "Command sent.";
      }
    } catch (error) {
      status.textContent = error.message;
    }
  };
  list.onchange = async (e) => {
    if (!e.target.matches("[data-tv-volume]")) return;
    try {
      await ioJSON(
        "/api/tv-devices/" +
          e.target.closest("[data-device]").dataset.device +
          "/command",
        "POST",
        { command: "volume", value: Number(e.target.value) },
      );
    } catch (error) {
      status.textContent = error.message;
    }
  };
  await load();
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = (active) =>
    nav(active).replace(
      "</nav>",
      '<a href="#/tv-devices">TV devices & remote</a></nav>',
    );
  window.addEventListener("hashchange", ioTVStart);
  window.addEventListener("load", ioTVStart);
})();
