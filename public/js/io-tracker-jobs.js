async function ioMountTrackerJobs(root) {
  const profile = Store.activeProfile,
    connections = await API._fetch(
      "/api/trackers/" + profile.id + "/connections",
    );
  if (!root.querySelector("#ioSyncForm")) return;
  const section = document.createElement("section");
  section.className = "io-settings-card";
  section.innerHTML =
    '<h2>Whole-list sync & automation</h2><p>Bulk sync matches titles already present in your library by tracker ID. Ambiguous duplicate IDs and text novels without chapter mappings are excluded. Preview up to 500 matched titles, then apply as a background job. Changes made after the preview become conflicts instead of being overwritten.</p><label>Tracker<select id="ioJobProvider">' +
    connections
      .map(
        (c) =>
          `<option value="${c.provider}">${c.provider === "mal" ? "MyAnimeList" : "AniList"}</option>`,
      )
      .join("") +
    '</select></label><label>Direction<select id="ioJobDirection"><option value="push">My I/O list → tracker</option><option value="pull">Tracker list → matching library titles</option></select></label><button class="btn btn-primary" id="ioBulkPreview" ' +
    (!connections.length ? "disabled" : "") +
    '>Preview whole-list sync</button><hr><label class="io-checkbox-row"><input type="checkbox" id="ioAutoTracker" ' +
    (!connections.length ? "disabled" : "") +
    '>Enable automatic progress sync</label><label>Automatic sync direction<select id="ioAutoDirection"><option value="push">I/O → tracker</option><option value="pull">Tracker → I/O</option></select></label><p>Publishing holds external conflicts and paused/repeat states for review. Importing updates matched local titles only when local progress has not changed; an empty local entry can be initialized from the tracker. Missing remote entries are skipped. Playback positions are preserved. Scores and dates use the separate details editor.</p><button class="btn btn-secondary" id="ioSaveAutomation" ' +
    (!connections.length ? "disabled" : "") +
    '>Save automation choice</button><button class="btn btn-secondary" id="ioRefreshJobs">Refresh progress</button><p id="ioJobsStatus" role="status"></p><div id="ioTrackerJobs"></div>';
  root.querySelector(".io-settings-content").append(section);
  const provider = section.querySelector("#ioJobProvider"),
    status = section.querySelector("#ioJobsStatus"),
    list = section.querySelector("#ioTrackerJobs");
  let busy = false;
  async function load() {
    if (!provider.value || !section.isConnected) return;
    try {
      const result = await API._fetch(
        "/api/trackers/" + profile.id + "/" + provider.value + "/jobs",
      );
      if (!section.isConnected) return;
      section.querySelector("#ioAutoTracker").checked =
        !!result.automation.enabled;
      section.querySelector("#ioAutoDirection").value=result.automation.direction||"push";
      status.textContent =
        result.automation.message ||
        "Automatic sync is off until you enable it.";
      list.innerHTML = result.jobs
        .map(
          (job) =>
            `<article class="io-sync-plan"><h3>${job.direction === "push" ? "I/O → tracker" : "Tracker → I/O"} · ${escapeHtml(job.status)}</h3><p>${job.entries.filter((e) => e.status === "done").length} of ${job.entries.length} completed${job.error ? " · " + escapeHtml(job.error) : ""}</p><details><summary>Review ${job.entries.length} matched titles</summary>${job.entries.map((e) => `<p><strong>${escapeHtml(e.title)}</strong>: ${escapeHtml(e.beforeLocal.status)} / ${e.beforeLocal.count} local · ${escapeHtml(e.beforeRemote.status)} / ${e.beforeRemote.count} tracker · ${escapeHtml(e.status)} ${escapeHtml(e.error)}</p>`).join("")}</details><div class="io-dialog-actions">${job.status === "preview" ? `<button class="btn btn-primary" data-apply-job="${job.id}">Apply this batch</button>` : ""}${["preview", "queued", "running"].includes(job.status) ? `<button class="btn btn-secondary" data-cancel-job="${job.id}">Cancel remaining changes</button>` : ""}</div></article>`,
        )
        .join("");
    } catch (error) {
      status.textContent = error.message;
    }
  }
  section.querySelector("#ioBulkPreview").onclick = async (e) => {
    if (busy) return;
    busy = true;
    e.target.disabled = true;
    status.textContent = "Reading your tracker list and preparing the preview…";
    try {
      await ioJSON(
        "/api/trackers/" + profile.id + "/" + provider.value + "/bulk-preview",
        "POST",
        { direction: section.querySelector("#ioJobDirection").value },
      );
      await load();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      e.target.disabled = false;
    }
  };
  section.querySelector("#ioSaveAutomation").onclick = async () => {
    try {
      await ioJSON(
        "/api/trackers/" + profile.id + "/" + provider.value + "/automation",
        "PUT",
        { enabled: section.querySelector("#ioAutoTracker").checked,direction:section.querySelector("#ioAutoDirection").value },
      );
      await load();
    } catch (error) {
      status.textContent = error.message;
    }
  };
  section.querySelector("#ioRefreshJobs").onclick = load;
  provider.onchange = load;
  list.onclick = async (e) => {
    const button = e.target.closest("[data-apply-job],[data-cancel-job]");
    if (!button) return;
    button.disabled = true;
    try {
      await ioJSON(
        "/api/trackers/" +
          profile.id +
          "/" +
          provider.value +
          "/jobs/" +
          (button.dataset.applyJob || button.dataset.cancelJob) +
          "/" +
          (button.dataset.applyJob ? "apply" : "cancel"),
        "POST",
        {},
      );
      await load();
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  };
  await load();
}
(function () {
  const original = window.ioPageTrackers;
  window.ioPageTrackers = async function (root) {
    await original(root);
    await ioMountTrackerJobs(root);
  };
})();
