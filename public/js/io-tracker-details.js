function ioTrackerDetailSummary(value) {
  const labels = {
      state: "Tracker state",
      score: "Score",
      startedAt: "Start date",
      completedAt: "Completion date",
      repeat: "Completed rewatches / rereads",
    },
    states = {
      planned: "Planned",
      current: "In progress",
      completed: "Completed",
      paused: "On hold",
      dropped: "Dropped",
      repeating: "Rewatching / rereading",
      unknown: "Unsupported provider state",
    };
  return (
    '<dl class="io-book-metadata">' +
    Object.entries(labels)
      .map(
        ([key, label]) =>
          "<dt>" +
          label +
          "</dt><dd>" +
          escapeHtml(
            String(
              key === "state"
                ? states[value[key]] || "Unknown"
                : (value[key] ?? "") === ""
                  ? "Not set"
                  : value[key],
            ),
          ) +
          "</dd>",
      )
      .join("") +
    "</dl>"
  );
}
async function ioMountTrackerDetails(root) {
  const source = root.querySelector("#ioSyncForm");
  if (!source) return;
  const section = document.createElement("section");
  section.className = "io-settings-card";
  section.innerHTML = `<h2>Scores, dates & repeat settings</h2><p>Review tracker-specific fields separately from episode/chapter progress. Select only the fields you want to change. A score of 0 clears the score; blank selected dates clear those dates.</p><form id="ioTrackerDetailsForm"><label>Tracker<select name="provider">${source.querySelector("[name=provider]").innerHTML}</select></label><label>Title<select name="title">${source.querySelector("[name=title]").innerHTML}</select></label><button type="button" id="ioReadDetails" class="btn btn-secondary">Load current tracker details</button><label>Direction<select name="direction"><option value="push">Edited details → tracker</option><option value="pull">Tracker details → this I/O profile</option></select></label><label><input type="checkbox" name="fields" value="state"> Change tracker state</label><label>Tracker state<select name="state"><option value="planned">Planned</option><option value="current">In progress</option><option value="completed">Completed</option><option value="paused">On hold</option><option value="dropped">Dropped</option><option value="repeating">Rewatching / rereading</option></select></label><label><input type="checkbox" name="fields" value="score"> Change score</label><label>Score (MAL: 0–10; AniList: 0–100)<input name="score" type="number" min="0" max="100" step="1" value="0"></label><label><input type="checkbox" name="fields" value="dates"> Change start and completion dates</label><label>Start date<input name="startedAt" placeholder="YYYY-MM-DD"></label><label>Completion date<input name="completedAt" placeholder="YYYY-MM-DD"></label><p>Some trackers contain incomplete dates. Complete or clear them before selecting a date change.</p><label><input type="checkbox" name="fields" value="repeat"> Change completed repeat count</label><label>Completed rewatches / rereads<input name="repeat" type="number" min="0" max="1000" step="1" value="0"></label><button class="btn btn-primary" id="ioPreviewDetails" disabled>Preview tracker details</button></form><div id="ioCurrentDetails"></div><div id="ioDetailsPlan"></div><p role="status" id="ioDetailsStatus"></p>`;
  root.querySelector(".io-settings-content").append(section);
  const form = section.querySelector("form"),
    status = section.querySelector("#ioDetailsStatus"),
    preview = section.querySelector("#ioPreviewDetails"),
    read = section.querySelector("#ioReadDetails"),
    plan = section.querySelector("#ioDetailsPlan");
  const titles = Store.filterForActiveProfile([
      ...Store.anime,
      ...Store.movies,
      ...Store.manga,
    ]).filter((t) => t.malId || t.anilistId),
    identity = () =>
      form.elements.provider.value + ":" + form.elements.title.value;
  function context() {
    const title = titles[Number(form.elements.title.value)];
    if (!title) throw Error("Choose a mapped title");
    return {
      itemId: title.id,
      itemType: Store.manga.some((m) => m.id === title.id) ? "manga" : "anime",
    };
  }
  const base = () =>
    "/api/trackers/" +
    encodeURIComponent(Store.activeProfile.id) +
    "/" +
    form.elements.provider.value +
    "/details/";
  for (const name of ["provider", "title"])
    form.elements[name].onchange = () => {
      preview.disabled = true;
      plan.replaceChildren();
      section.querySelector("#ioCurrentDetails").replaceChildren();
    };
  read.disabled = !form.elements.provider.value || !titles.length;
  read.onclick = async () => {
    const selection = identity();
    read.disabled = true;
    try {
      const data = await ioJSON(base() + "read", "POST", context());
      if (selection !== identity() || !section.isConnected) return;
      const r = data.remote;
      for (const k of ["state", "score", "startedAt", "completedAt", "repeat"])
        form.elements[k].value = r[k] ?? "";
      form.elements.score.max =
        form.elements.provider.value === "mal" ? "10" : "100";
      section.querySelector("#ioCurrentDetails").innerHTML =
        "<h3>Current tracker details</h3>" +
        ioTrackerDetailSummary(r) +
        (data.local
          ? "<h3>Saved on this profile</h3>" +
            ioTrackerDetailSummary(data.local)
          : "");
      preview.disabled = false;
      status.textContent =
        "Details loaded. Choose the fields to change, then preview.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      read.disabled = false;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    preview.disabled = true;
    const selection = identity();
    try {
      const data = new FormData(form),
        result = await ioJSON(base() + "preview", "POST", {
          ...context(),
          direction: data.get("direction"),
          fields: data.getAll("fields"),
          state: data.get("state"),
          score: Number(data.get("score")),
          startedAt: data.get("startedAt").trim(),
          completedAt: data.get("completedAt").trim(),
          repeat: Number(data.get("repeat")),
        });
      if (selection !== identity() || !section.isConnected) return;
      plan.innerHTML = `<div class="io-sync-plan"><h3>Review tracker details: ${escapeHtml(result.title)}</h3><p>${result.direction === "push" ? "Update the selected fields on your tracker." : "Save the tracker details on this I/O profile."}</p><h4>Current tracker details</h4>${ioTrackerDetailSummary(result.before)}<h4>After this change</h4>${ioTrackerDetailSummary(result.after)}<button type="button" class="btn btn-primary">Apply reviewed details</button></div>`;
      const endpoint = base() + "apply";
      plan.querySelector("button").onclick = async (event) => {
        event.target.disabled = true;
        try {
          await ioJSON(endpoint, "POST", { planId: result.id });
          plan.replaceChildren();
          status.textContent = "Tracker details saved.";
        } catch (error) {
          status.textContent = error.message;
          plan.replaceChildren();
        }
      };
    } catch (error) {
      status.textContent = error.message;
    } finally {
      preview.disabled = false;
    }
  };
}
(function () {
  const original = window.ioPageTrackers;
  window.ioPageTrackers = async function (root) {
    await original(root);
    await ioMountTrackerDetails(root);
  };
})();
