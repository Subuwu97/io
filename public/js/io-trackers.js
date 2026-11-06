async function ioPageTrackers(root) {
  const route = location.hash,
    profile = Store.activeProfile;
  await Store.loadLibrary();
  const [setup, connections] = await Promise.all([
    API._fetch("/api/trackers/setup"),
    API._fetch("/api/trackers/" + profile.id + "/connections"),
  ]);
  if (route !== location.hash) return;
  const titles = Store.filterForActiveProfile([
    ...Store.anime,
    ...Store.movies,
    ...Store.manga,
  ]).filter((s) => s.malId || s.anilistId);
  root.innerHTML = ioSettingsShell(
    "Personal tracker sync",
    `<section class="io-settings-card"><h2>MyAnimeList & AniList</h2><p>Connections belong to the current viewing profile. Only titles with a matching tracker ID can sync. Review every change before applying it; this does not merge or delete whole tracker lists.</p>${[
      "mal",
      "anilist",
    ]
      .map((name) => {
        const c = connections.find((c) => c.provider === name),
          label = name === "mal" ? "MyAnimeList" : "AniList";
        return `<article class="io-inbox-item"><div><strong>${label}</strong><p>${c ? "Connected as " + escapeHtml(c.displayName) : setup[name] ? "Ready to connect" : "Administrator setup required"}</p></div><button class="btn btn-secondary" data-tracker="${name}" data-connected="${!!c}" ${!setup[name] && !c ? "disabled" : ""}>${c ? "Disconnect" : "Connect"}</button></article>`;
      })
      .join(
        "",
      )}<form id="ioSyncForm"><label>Tracker<select name="provider">${connections.map((c) => `<option value="${c.provider}">${c.provider === "mal" ? "MyAnimeList" : "AniList"}</option>`).join("")}</select></label><label>Title<select name="title">${titles.map((s, i) => `<option value="${i}">${escapeHtml(s.title)}</option>`).join("")}</select></label><label>Direction<select name="direction"><option value="push">I/O → tracker</option><option value="pull">Tracker → I/O</option></select></label><p>Progress counts use the library’s episode/chapter order. Confirm the title ID and season match before syncing. Pulling replaces this title’s completion markers, limited to chapters/episodes present locally; playback resume positions are preserved. On-hold/paused maps to Planned.</p><button class="btn btn-primary" ${!connections.length || !titles.length ? "disabled" : ""}>Preview changes</button></form><div id="ioSyncPreview"></div><p id="ioTrackerStatus" role="status"></p></section>${Store.account.role === "admin" ? `<section class="io-settings-card"><details><summary>Tracker application setup</summary><p>Create your own applications and set these callbacks:</p><p class="io-person-bio">MyAnimeList: ${escapeHtml(setup.malRedirect)}<br>AniList: ${escapeHtml(setup.anilistRedirect)}</p><form id="ioTrackerSetup"><label>MyAnimeList client ID<input name="malClientId" value="${escapeHtml(setup.malClientId)}"></label><label>MyAnimeList client secret (optional, blank keeps current)<input name="malSecret" type="password" autocomplete="new-password"></label><label>AniList client ID<input name="anilistClientId" value="${escapeHtml(setup.anilistClientId)}"></label><label>AniList client secret (blank keeps current)<input name="anilistSecret" type="password" autocomplete="new-password"></label>${ioProofFields()}<button class="btn btn-primary">Save tracker setup</button></form></details></section>` : ""}`,
    "trackers",
  );
  wireNavbar();
  const status = root.querySelector("#ioTrackerStatus"),
    base = "/api/trackers/" + encodeURIComponent(profile.id) + "/";
  root.querySelectorAll("[data-tracker]").forEach(
    (button) =>
      (button.onclick = async () => {
        const name = button.dataset.tracker;
        button.disabled = true;
        try {
          if (button.dataset.connected === "true") {
            await API._fetch(base + name, { method: "DELETE" });
            await ioPageTrackers(root);
          } else {
            const result = await ioJSON(base + name + "/connect", "POST", {});
            location.assign(result.url);
          }
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
        }
      }),
  );
  root.querySelector("#ioSyncForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(e.target),
      title = titles[Number(data.get("title"))],
      provider = data.get("provider"),
      itemType = Store.manga.some((m) => m.id === title.id) ? "manga" : "anime";
    try {
      const plan = await ioJSON(base + provider + "/preview", "POST", {
        itemId: title.id,
        itemType,
        direction: data.get("direction"),
      });
      const target = plan.direction === "push" ? "tracker" : "I/O",
        before =
          plan.direction === "push" ? plan.beforeRemote : plan.beforeLocal,
        after =
          plan.direction === "push" ? plan.beforeLocal : plan.beforeRemote;
      const preview = root.querySelector("#ioSyncPreview");
      preview.innerHTML = `<div class="io-sync-plan"><h3>Review: ${escapeHtml(plan.title)}</h3><p>Update ${target} from <strong>${escapeHtml(before.status)} · ${before.count}</strong> completed to <strong>${escapeHtml(after.status)} · ${after.count}</strong> completed.</p><button class="btn btn-primary" id="ioApplySync">Apply this change</button><button class="btn btn-secondary" id="ioCancelSync">Cancel</button></div>`;
      preview.querySelector("#ioCancelSync").onclick = () =>
        preview.replaceChildren();
      preview.querySelector("#ioApplySync").onclick = async (event) => {
        event.target.disabled = true;
        try {
          await ioJSON(base + provider + "/apply", "POST", { planId: plan.id });
          preview.replaceChildren();
          status.textContent = "Title synced.";
          const current = await API.listProfiles();
          Store.profiles = current;
          Store.activeProfile =
            current.find((p) => p.id === profile.id) || Store.activeProfile;
        } catch (error) {
          status.textContent = error.message;
          preview.replaceChildren();
        }
      };
    } catch (error) {
      status.textContent = error.message;
    }
  };
  const setupForm = root.querySelector("#ioTrackerSetup");
  if (setupForm)
    setupForm.onsubmit = async (e) => {
      e.preventDefault();
      const data = new FormData(setupForm);
      try {
        await ioJSON("/api/trackers/setup", "PUT", {
          ...Object.fromEntries(data),
          ...ioProof(root),
        });
        await ioPageTrackers(root);
        showToast("Tracker setup saved");
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
      '<a href="#/trackers">Personal tracker sync</a></nav>',
    );
})();
