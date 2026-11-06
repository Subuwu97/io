async function ioPageNewPopular(root) {
  const route = location.hash;
  await Promise.all([Store.loadLibrary(), ioLoadExperience()]);
  const data = await API._fetch("/api/discovery-plus");
  if (route !== location.hash) return;
  const filter = (items) => Store.filterForActiveProfile(items),
    all = filter([...Store.anime, ...Store.movies]),
    rank = (rows, items) =>
      rows
        .map((r) => ({ item: items.find((i) => i.id === r.id), rank: r.rank }))
        .filter(
          (r) =>
            r.item &&
            (!Store.isKidsActive() || !Store.isMatureRating(r.item.rating)),
        ),
    upcoming = data.upcoming.filter(
      (s) => !Store.isKidsActive() || !Store.isMatureRating(s.rating),
    );
  const recent = [...all].sort(
      (a, b) => new Date(b.dateAdded) - new Date(a.dateAdded),
    ),
    today = recent.filter((s) => Date.now() - new Date(s.dateAdded) < 86400000),
    row = (title, items) =>
      `<section class="io-popular-section"><h2>${title}</h2><div class="io-popular-cards">${items.map((s) => animeCardHTML(s, { tall: true })).join("") || "<p>No titles in this row yet.</p>"}</div></section>`,
    rankRow = (title, rows, items) =>
      `<section class="io-popular-section"><h2>${title}</h2><p>Ranked by viewers completing episodes on this I/O server in the last ${data.rankingPeriod}.</p><div class="io-popular-cards">${
        rank(rows, items)
          .map(
            (r, i) =>
              `<div class="io-ranked-card"><span class="io-rank">${i + 1}</span>${animeCardHTML(r.item, { tall: true })}</div>`,
          )
          .join("") || "<p>Finish an episode to start the local rankings.</p>"
      }</div></section>`;
  root.innerHTML =
    renderNavbar("new") +
    `<main class="io-popular-page"><header class="io-popular-hero"><span>YOUR NEXT STORY</span><h1>New & Popular</h1><p>Fresh arrivals, local favorites and what’s coming next.</p><div class="io-dialog-actions"><a class="btn btn-primary" href="#ioNewToday">New today</a><a class="btn btn-secondary" href="#/calendar">Release calendar</a>${Store.account.role === "admin" ? '<a href="#/upcoming-manage">Manage coming soon</a>' : ""}</div></header><div id="ioNewToday">${row("New today", today)}</div>${rankRow("Top 10 shows", data.series, Store.anime)}${rankRow("Top 10 movies", data.movies, Store.movies)}${row("Recently added", recent.slice(0, 20))}<section class="io-popular-section"><h2>Coming soon</h2><p>Dates are maintained by your I/O administrator and may change.</p><div class="io-people-grid">${upcoming.map((s) => `<article class="io-person-card"><span>${escapeHtml(s.kind)} · ${escapeHtml(new Date(s.release_at).toLocaleDateString())}</span><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.description)}</p><small>Not available to play yet</small></article>`).join("") || "<p>No upcoming titles have been scheduled.</p>"}</div></section></main>`;
  wireNavbar();
  wireCardNav(root);
  root.querySelector('a[href="#ioNewToday"]').onclick = (e) => {
    e.preventDefault();
    root.querySelector("#ioNewToday").scrollIntoView({ behavior: "smooth" });
  };
}
async function ioPageUpcoming(root) {
  const data = await API._fetch("/api/discovery-plus");
  root.innerHTML = ioSettingsShell(
    "Coming soon schedule",
    `<section class="io-settings-card"><p>Scheduling a title is an announcement, not an upload or download. Add media to your library separately when it is available.</p><form id="ioUpcomingForm"><label>Title<input name="title" required maxlength="200"></label><label>Description<textarea name="description" maxlength="2000"></textarea></label><label>Format<select name="kind"><option value="series">Series</option><option value="movie">Movie</option><option value="manga">Manga</option></select></label><label>Rating<input name="rating" maxlength="30" placeholder="PG-13"></label><label>Expected date and time<input name="date" type="datetime-local" required></label><button class="btn btn-primary">Schedule title</button></form><p role="status" id="ioUpcomingStatus"></p><div id="ioUpcomingList">${data.upcoming.map((s) => `<article class="io-inbox-item"><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(new Date(s.release_at).toLocaleString())}</span><button class="btn-ghost" data-remove-upcoming="${s.id}">Remove</button></article>`).join("")}</div></section>`,
    "upcoming",
  );
  wireNavbar();
  const status = root.querySelector("#ioUpcomingStatus");
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    try {
      await ioJSON("/api/discovery-plus/upcoming", "POST", {
        title: d.get("title"),
        description: d.get("description"),
        kind: d.get("kind"),
        rating: d.get("rating"),
        releaseAt: new Date(d.get("date")).toISOString(),
      });
      await ioPageUpcoming(root);
    } catch (error) {
      status.textContent = error.message;
    }
  };
  root.querySelector("#ioUpcomingList").onclick = async (e) => {
    const button = e.target.closest("[data-remove-upcoming]");
    if (!button) return;
    try {
      await API._fetch(
        "/api/discovery-plus/upcoming/" + button.dataset.removeUpcoming,
        { method: "DELETE" },
      );
      await ioPageUpcoming(root);
    } catch (error) {
      status.textContent = error.message;
    }
  };
}
async function ioBookDetails(root, id) {
  const list = root.querySelector("#chapterList");
  if (!list) return;
  const data = await API._fetch(
    "/api/discovery-plus/books/" + encodeURIComponent(id),
  );
  if (!list.isConnected) return;
  const book = Store.findManga(id);
  const section = document.createElement("section");
  section.className = "io-book-metadata";
  section.innerHTML =
    "<h2>Book details</h2><dl>" +
    [
      ["Author", data.author],
      ["Artist", data.artist],
      ["Publisher", data.publisher],
      ["Publication", data.publicationStatus],
      ["Language", data.language],
      ["Chapters", book?.chapterCount],
      [
        "Pages",
        (book?.chapters || []).reduce((n, c) => n + (c.pageCount || 0), 0),
      ],
    ]
      .filter(([, v]) => v)
      .map(
        ([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`,
      )
      .join("") +
    "</dl>";
  list.before(section);
  if (data.volumes.length) {
    const rows = [...list.children],
      byName = new Map(
        rows.map((r) => {
          try {
            return [decodeURIComponent(r.dataset.chapter), r];
          } catch {
            return ["", r];
          }
        }),
      );
    for (const volume of data.volumes) {
      const group = document.createElement("details");
      group.className = "io-volume";
      group.open = true;
      const summary = document.createElement("summary");
      summary.textContent =
        volume.name + " · " + volume.chapters.length + " chapters";
      group.append(summary);
      for (const name of volume.chapters) {
        const row = byName.get(name);
        if (row) group.append(row);
      }
      list.append(group);
    }
    const ungrouped = rows.filter((r) => r.parentElement === list);
    if (ungrouped.length) {
      const group = document.createElement("details");
      group.className = "io-volume";
      group.open = true;
      group.innerHTML = "<summary>Other chapters</summary>";
      ungrouped.forEach((r) => group.append(r));
      list.append(group);
    }
  }
  for (const row of list.querySelectorAll(".data-chapter-row")) {
    row.tabIndex = 0;
    row.setAttribute("role", "link");
    row.setAttribute(
      "aria-label",
      "Read " + decodeURIComponent(row.dataset.chapter),
    );
    row.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        row.click();
      }
    };
  }
  if (Store.account.role === "admin") {
    const editor = document.createElement("details");
    editor.className = "io-volume";
    editor.innerHTML = `<summary>Edit book details & volumes</summary><form>${[
      ["author", "Author"],
      ["artist", "Artist"],
      ["publisher", "Publisher"],
      ["publicationStatus", "Publication status"],
      ["language", "Language"],
    ]
      .map(
        ([k, l]) =>
          `<label>${l}<input name="${k}" maxlength="200" value="${escapeHtml(data[k])}"></label>`,
      )
      .join(
        "",
      )}<label>Volume names — one per line<textarea name="volumeNames" rows="4">${escapeHtml(data.volumes.map((v) => v.name).join("\n"))}</textarea></label><div class="io-volume-chapter-fields">${(book?.chapters || []).map((c, i) => `<label>${escapeHtml(c.name)}<select data-chapter-index="${i}"><option value="">Ungrouped</option>${data.volumes.map((v) => `<option value="${escapeHtml(v.name)}" ${v.chapters.includes(c.name) ? "selected" : ""}>${escapeHtml(v.name)}</option>`).join("")}</select></label>`).join("")}</div><p>Add volume names, then choose a volume for each chapter.</p><button class="btn btn-primary">Save book details</button><p role="status"></p></form>`;
    section.append(editor);
    const volumeNames = editor.querySelector("[name=volumeNames]");
    volumeNames.oninput = () => {
      const names = [
        ...new Set(
          volumeNames.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
      for (const select of editor.querySelectorAll("[data-chapter-index]")) {
        const current = select.value;
        select.innerHTML =
          '<option value="">Ungrouped</option>' +
          names
            .map(
              (n) =>
                `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`,
            )
            .join("");
        select.value = names.includes(current) ? current : "";
      }
    };
    editor.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target,
        d = new FormData(form);
      try {
        await ioJSON(
          "/api/discovery-plus/books/" + encodeURIComponent(id),
          "PUT",
          {
            ...Object.fromEntries(
              [
                "author",
                "artist",
                "publisher",
                "publicationStatus",
                "language",
              ].map((k) => [k, d.get(k)]),
            ),
            volumes: [
              ...new Set(
                String(d.get("volumeNames"))
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              ),
            ].map((name) => ({
              name,
              chapters: [...form.querySelectorAll("[data-chapter-index]")]
                .filter((s) => s.value === name)
                .map((s) => book.chapters[Number(s.dataset.chapterIndex)].name),
            })),
          },
        );
        await pageMangaDetail(root, id);
      } catch (error) {
        form.querySelector("[role=status]").textContent = error.message;
      }
    };
  }
}
(function () {
  const detail = window.pageMangaDetail;
  window.pageMangaDetail = async function (root, id) {
    await detail(root, id);
    await ioBookDetails(root, id);
  };
})();
