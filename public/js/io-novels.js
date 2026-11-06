async function ioPageNovel(root, id, chapter) {
  const profile = Store.activeProfile,
    route = location.hash,
    base =
      "/api/novels/" +
      encodeURIComponent(id) +
      "/" +
      encodeURIComponent(chapter),
    query = "?profile=" + encodeURIComponent(profile.id),
    data = await API._fetch(base + query);
  if (location.hash !== route) return;
  let current = Math.min(data.sections.length - 1, data.progress.section),
    prefs = { ...data.preferences },
    fraction = data.progress.fraction,
    generation = 0,
    timer,
    disposed = false;
  root.innerHTML =
    renderNavbar("books") +
    `<main class="io-novel" data-theme="${prefs.theme}"><header><a href="#/manga/${encodeURIComponent(id)}">‹ ${escapeHtml(data.title)}</a><h1>${escapeHtml(chapter)}</h1><div class="io-novel-controls"><button class="btn btn-secondary" id="ioNovelPrev">Previous section</button><label>Section<select id="ioNovelSection">${data.sections.map((s) => `<option value="${s.index}">${escapeHtml(s.title)}</option>`).join("")}</select></label><button class="btn btn-secondary" id="ioNovelNext">Next section</button></div><details><summary>Reading appearance</summary><div class="io-novel-controls"><label>Text size<input type="range" min="14" max="36" step="1" value="${prefs.size}" id="ioNovelSize"></label><label>Line spacing<input type="range" min="1.3" max="2.4" step="0.1" value="${prefs.spacing}" id="ioNovelSpacing"></label><label>Column width<input type="range" min="480" max="1100" step="20" value="${prefs.width}" id="ioNovelWidth"></label><label>Theme<select id="ioNovelTheme"><option value="dark">Dark</option><option value="sepia">Sepia</option><option value="light">Light</option></select></label></div></details><p id="ioNovelStatus" role="status"></p></header><article id="ioNovelArticle" tabindex="0"></article><footer><button class="btn btn-primary" id="ioNovelNextBottom">Continue to next section</button></footer></main>`;
  wireNavbar();
  const notebook = document.createElement("details");
  notebook.innerHTML =
    '<summary>Contents, bookmarks & notes</summary><div class="io-novel-controls"><label>Table of contents<select id="ioNovelContents"><option value="">Choose a chapter</option>' +
    (data.navigation?.length ? data.navigation : data.sections)
      .map(
        (s) =>
          '<option value="' +
          s.index +
          '">' +
          escapeHtml(s.title) +
          "</option>",
      )
      .join("") +
    '</select></label><button class="btn btn-secondary" id="ioNovelQuote">Use selected text</button><button class="btn btn-secondary" id="ioNovelBookmark">Bookmark this location</button></div><form id="ioNovelNoteForm"><label>Quote (optional)<textarea name="quote" maxlength="2000"></textarea></label><label>Your note<textarea name="note" maxlength="4000"></textarea></label><button class="btn btn-primary">Save note at this location</button></form><div id="ioNovelNotes"></div>';
  root.querySelector(".io-novel header").append(notebook);
  const page = root.querySelector(".io-novel"),
    article = root.querySelector("#ioNovelArticle"),
    status = root.querySelector("#ioNovelStatus"),
    select = root.querySelector("#ioNovelSection");
  root.querySelector("#ioNovelTheme").value = prefs.theme;
  function appearance() {
    page.dataset.theme = prefs.theme;
    article.style.fontSize = prefs.size + "px";
    article.style.lineHeight = String(prefs.spacing);
    article.style.maxWidth = prefs.width + "px";
  }
  appearance();
  root.querySelector("#ioNovelContents").onchange = (event) => {
    if (event.target.value !== "")
      load(Number(event.target.value)).catch(
        (e) => (status.textContent = e.message),
      );
  };
  const noteForm = root.querySelector("#ioNovelNoteForm"),
    notesRoot = root.querySelector("#ioNovelNotes");
  async function refreshNotes() {
    const notes = await API._fetch(base + "/notes" + query);
    if (disposed) return;
    notesRoot.innerHTML =
      notes
        .map(
          (n) =>
            '<article class="io-settings-card"><p>' +
            escapeHtml(n.quote) +
            "</p><p>" +
            escapeHtml(n.note) +
            '</p><button class="btn btn-secondary" data-jump="' +
            n.id +
            '">Go to section ' +
            (n.section + 1) +
            '</button> <button class="btn btn-secondary" data-remove="' +
            n.id +
            '">Remove note</button></article>',
        )
        .join("") || "<p>No saved bookmarks or notes yet.</p>";
    notesRoot.querySelectorAll("[data-jump]").forEach(
      (b) =>
        (b.onclick = () => {
          const n = notes.find((n) => n.id === b.dataset.jump);
          load(n.section, n.fraction).catch(
            (e) => (status.textContent = e.message),
          );
        }),
    );
    notesRoot.querySelectorAll("[data-remove]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await ioJSON(
              base + "/notes/" + encodeURIComponent(b.dataset.remove),
              "DELETE",
              { profileId: profile.id },
            );
            await refreshNotes();
          } catch (e) {
            status.textContent = e.message;
          }
        }),
    );
  }
  async function addNote(quote, note) {
    await ioJSON(base + "/notes", "POST", {
      profileId: profile.id,
      section: current,
      fraction,
      quote,
      note,
    });
    await refreshNotes();
    status.textContent = "Saved to this viewing profile.";
  }
  root.querySelector("#ioNovelQuote").onclick = () => {
    const selection = window.getSelection();
    if (
      selection &&
      article.contains(selection.anchorNode) &&
      article.contains(selection.focusNode)
    )
      noteForm.elements.quote.value = selection.toString().slice(0, 2000);
    else status.textContent = "Select text inside the current section first.";
  };
  root.querySelector("#ioNovelBookmark").onclick = () =>
    addNote("", "Bookmark").catch((e) => (status.textContent = e.message));
  noteForm.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await addNote(
        noteForm.elements.quote.value,
        noteForm.elements.note.value,
      );
      noteForm.reset();
    } catch (e) {
      status.textContent = e.message;
    }
  };
  refreshNotes().catch((e) => (status.textContent = e.message));
  async function save() {
    try {
      await ioJSON(base + "/progress", "PUT", {
        profileId: profile.id,
        section: current,
        fraction,
        preferences: prefs,
      });
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  }
  async function load(index, restored = 0) {
    if (index < 0 || index >= data.sections.length) return;
    clearTimeout(timer);
    if (article.innerHTML) await save();
    const request = ++generation,
      result = await API._fetch(base + "/section/" + index + query);
    if (disposed || request !== generation) return;
    current = index;
    fraction = restored;
    article.innerHTML = result.html;
    select.value = String(index);
    root.querySelector("#ioNovelPrev").disabled = !index;
    root.querySelector("#ioNovelNext").disabled =
      index === data.sections.length - 1;
    root.querySelector("#ioNovelNextBottom").disabled =
      index === data.sections.length - 1;
    status.textContent =
      "Section " + (index + 1) + " of " + data.sections.length;
    requestAnimationFrame(() => {
      const top = article.getBoundingClientRect().top + scrollY;
      window.scrollTo(
        0,
        top + Math.max(0, article.scrollHeight - innerHeight) * restored - 20,
      );
    });
    schedule();
  }
  root.querySelector("#ioNovelPrev").onclick = () =>
    load(current - 1).catch((e) => (status.textContent = e.message));
  for (const key of ["#ioNovelNext", "#ioNovelNextBottom"])
    root.querySelector(key).onclick = () =>
      load(current + 1).catch((e) => (status.textContent = e.message));
  select.onchange = () =>
    load(Number(select.value)).catch((e) => (status.textContent = e.message));
  for (const [selector, key] of [
    ["#ioNovelSize", "size"],
    ["#ioNovelSpacing", "spacing"],
    ["#ioNovelWidth", "width"],
    ["#ioNovelTheme", "theme"],
  ])
    root.querySelector(selector).onchange = (e) => {
      prefs[key] = key === "theme" ? e.target.value : Number(e.target.value);
      appearance();
      schedule();
    };
  const scroll = () => {
    if (disposed || !article.innerHTML) return;
    const top = article.getBoundingClientRect().top + scrollY;
    fraction = Math.max(
      0,
      Math.min(
        1,
        (scrollY - top + 20) / Math.max(1, article.scrollHeight - innerHeight),
      ),
    );
    schedule();
  };
  window.addEventListener("scroll", scroll, { passive: true });
  window.addEventListener(
    "hashchange",
    () => {
      disposed = true;
      generation++;
      clearTimeout(timer);
      window.removeEventListener("scroll", scroll);
      save();
    },
    { once: true },
  );
  await load(current, fraction);
}
(function () {
  const reader = window.pageReader;
  window.pageReader = async function (root, id, chapterEncoded, ...args) {
    await Store.loadLibrary();
    const book = Store.findManga(id),
      chapter = decodeURIComponent(chapterEncoded);
    if (book?.chapters?.some((c) => c.name === chapter && c.format === "novel"))
      return ioPageNovel(root, id, chapter);
    return reader(root, id, chapterEncoded, ...args);
  };
})();
