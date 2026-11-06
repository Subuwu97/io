(function () {
  const original = window.ioPageTrackers;
  window.ioPageTrackers = async function (root) {
    await original(root);
    if (location.hash !== "#/trackers") return;
    const profile = Store.activeProfile,
      shows = Store.filterForActiveProfile([
        ...Store.anime,
        ...Store.movies,
      ]).filter((s) => s.groups?.some((g) => g.episodes.length)),
      source = root.querySelector("#ioSyncForm [name=provider]");
    const section = document.createElement("section");
    section.className = "io-settings-card";
    section.innerHTML =
      '<h2>Season-specific tracker mapping</h2><p>Map one local season to its own tracker entry. Sync changes only this season’s watched markers or tracker episode count; list status, scores and other seasons stay unchanged. Titles using season mappings are excluded from whole-title and automatic sync. Add the season to your tracker list first.</p><form><label>Tracker<select name="provider">' +
      source.innerHTML +
      '</select></label><label>Local title<select name="show">' +
      shows
        .map(
          (s, i) =>
            '<option value="' + i + '">' + escapeHtml(s.title) + "</option>",
        )
        .join("") +
      '</select></label><label>Local season<select name="group"></select></label><label>Tracker season ID<input name="trackerId" type="number" min="1" max="2147483647" required></label><button class="btn btn-secondary" type="button" id="ioSaveSeasonMap">Save season mapping</button><button class="btn btn-secondary" type="button" id="ioRemoveSeasonMap">Remove season mapping</button><label>Direction<select name="direction"><option value="push">I/O → tracker</option><option value="pull">Tracker → I/O</option></select></label><button class="btn btn-primary" ' +
      (!source.options.length || !shows.length ? "disabled" : "") +
      '>Preview season progress</button></form><p role="status"></p><div class="io-season-plan"></div>';
    root.querySelector(".io-settings-content").append(section);
    const form = section.querySelector("form"),
      status = section.querySelector("[role=status]"),
      plan = section.querySelector(".io-season-plan");
    const base = () =>
      "/api/trackers/" +
      encodeURIComponent(profile.id) +
      "/" +
      form.elements.provider.value +
      "/seasons";
    const body = () => ({
      itemId: shows[Number(form.elements.show.value)]?.id,
      group: form.elements.group.value,
    });
    async function refreshMapping() {
      plan.replaceChildren();
      form.elements.trackerId.value = "";
      if (!form.elements.provider.value || !body().itemId) return;
      try {
        const key = base() + JSON.stringify(body()),
          rows = await API._fetch(base());
        if (key !== base() + JSON.stringify(body()) || !section.isConnected)
          return;
        const row = rows.find(
          (r) => r.item_id === body().itemId && r.group_name === body().group,
        );
        if (row) form.elements.trackerId.value = row.tracker_id;
      } catch (e) {
        status.textContent = e.message;
      }
    }
    function groups() {
      form.elements.group.innerHTML = (
        shows[Number(form.elements.show.value)]?.groups || []
      )
        .filter((g) => g.episodes.length)
        .map((g) => "<option>" + escapeHtml(g.name) + "</option>")
        .join("");
      refreshMapping();
    }
    form.elements.show.onchange = groups;
    form.elements.group.onchange = refreshMapping;
    form.elements.provider.onchange = refreshMapping;
    groups();
    section.querySelector("#ioSaveSeasonMap").onclick = async () => {
      try {
        await ioJSON(base(), "PUT", {
          ...body(),
          trackerId: Number(form.elements.trackerId.value),
        });
        plan.replaceChildren();
        status.textContent =
          "Season mapping saved. Verify the tracker ID, then preview progress.";
      } catch (e) {
        status.textContent = e.message;
      }
    };
    section.querySelector('#ioRemoveSeasonMap').onclick=async()=>{try{await ioJSON(base(),'DELETE',body());await refreshMapping();status.textContent='Season mapping removed. Whole-title sync is available when this title has no remaining mappings.';}catch(e){status.textContent=e.message;}};
    form.onsubmit = async (event) => {
      event.preventDefault();
      plan.replaceChildren();
      const endpoint = base();
      try {
        const p = await ioJSON(endpoint + "/preview", "POST", {
          ...body(),
          direction: form.elements.direction.value,
        });
        if (!section.isConnected || endpoint !== base()) return;
        plan.innerHTML =
          "<h3>Review " +
          escapeHtml(p.title) +
          " · " +
          escapeHtml(p.group) +
          "</h3><p>Tracker ID " +
          p.trackerId +
          " · I/O: " +
          p.localCount +
          " episodes · Tracker: " +
          p.remoteCount +
          " episodes. Update " +
          (p.direction === "push" ? "tracker" : "I/O") +
          '.</p><button class="btn btn-primary">Apply reviewed season progress</button>';
        plan.querySelector("button").onclick = async (e) => {
          e.target.disabled = true;
          try {
            await ioJSON(endpoint + "/apply", "POST", { planId: p.id });
            plan.replaceChildren();
            status.textContent = "Season progress synced.";
          } catch (error) {
            plan.replaceChildren();
            status.textContent = error.message;
          }
        };
      } catch (e) {
        status.textContent = e.message;
      }
    };
  };
})();
