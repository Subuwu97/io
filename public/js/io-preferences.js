async function ioLoadExperience() {
  const p = Store.activeProfile;
  if (!p) return;
  const value = await API._fetch("/api/experience/" + encodeURIComponent(p.id));
  if (Store.activeProfile?.id === p.id) {
    p.experience = value;
    return value;
  }
}
async function ioPageExperience(root, onboarding = false) {
  const profile = Store.activeProfile,
    hash = location.hash,
    p = await ioLoadExperience();
  await Store.loadLibrary();
  if (location.hash !== hash) return;
  const genres = [
    ...new Set(
      [...Store.anime, ...Store.movies, ...Store.manga].flatMap(
        (s) => s.genres || [],
      ),
    ),
  ].sort();
  const select = (key, label, values) =>
      `<label>${label}<select name="${key}">${values.map(([v, l]) => `<option value="${v}" ${p[key] === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`,
    range = (key, label, min, max) =>
      `<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" value="${p[key]}"></label>`;
  root.innerHTML = ioSettingsShell(
    onboarding ? "Make I/O yours" : "Playback & reading preferences",
    `<form class="io-settings-card" id="ioExperienceForm"><h2>Your taste</h2><p>Choose genres you enjoy and ones to leave out of your recommendation row. This only uses your local library.</p><fieldset><legend>Enjoy</legend>${genres.map((g) => `<label class="io-checkbox-row"><input type="checkbox" name="genres" value="${escapeHtml(g)}" ${p.genres.includes(g) ? "checked" : ""}>${escapeHtml(g)}</label>`).join("") || "<p>Add genre metadata to your library to tailor recommendations.</p>"}</fieldset><fieldset><legend>Leave out of recommendations</legend>${genres.map((g) => `<label class="io-checkbox-row"><input type="checkbox" name="avoidGenres" value="${escapeHtml(g)}" ${p.avoidGenres.includes(g) ? "checked" : ""}>${escapeHtml(g)}</label>`).join("")}</fieldset><h2>Language & playback</h2>${select(
      "interfaceLanguage",
      "Navigation language",
      [
        ["en", "English"],
        ["es", "Español"],
        ["fr", "Français"],
        ["ja", "日本語"],
      ],
    )}<p>Translates navigation and settings headings. Descriptions and some controls remain in English.</p>${select("quality", "Default quality", [["auto", "Auto"], ["original", "Original"], ...["1080", "720", "480", "360", "240"].map((v) => [v, v + "p"])])}${select(
      "titleLanguage",
      "Title display",
      [
        ["default", "Library default"],
        ["english", "English, when available"],
        ["romaji", "Romanized, when available"],
        ["native", "Native, when available"],
      ],
    )}${select("preferredAudio", "Preferred audio", [
      ["", "Use existing preference"],
      ["eng", "English"],
      ["jpn", "Japanese"],
      ["spa", "Spanish"],
      ["fra", "French"],
      ["deu", "German"],
    ])}${select("preferredSubtitles", "Preferred subtitles", [
      ["", "Use existing preference"],
      ["eng", "English"],
      ["jpn", "Japanese"],
      ["spa", "Spanish"],
      ["fra", "French"],
      ["deu", "German"],
    ])}${[
      ["blurMature", "Blur mature artwork until hovered or focused"],
      ["showIntro", "Show Skip Intro controls"],
      ["showOutro", "Show Skip Outro controls"],
    ]
      .map(
        ([k, l]) =>
          `<label class="io-checkbox-row"><input type="checkbox" name="${k}" ${p[k] ? "checked" : ""}>${l}</label>`,
      )
      .join(
        "",
      )}<h2>Text subtitles</h2><p>Applies to plain text subtitles. Authored ASS effects retain their own styling.</p>${select(
      "subtitleFont",
      "Font",
      [
        ["sans-serif", "Sans serif"],
        ["serif", "Serif"],
        ["monospace", "Monospace"],
      ],
    )}${range("subtitleScale", "Size (%)", 50, 200)}${range("subtitleOpacity", "Text opacity (%)", 10, 100)}${range("subtitleBackgroundOpacity", "Background opacity (%)", 0, 100)}${select(
      "subtitleEffect",
      "Text effect",
      [
        ["outline", "Outline"],
        ["shadow", "Shadow"],
        ["none", "None"],
      ],
    )}<button class="btn btn-primary">${onboarding ? "Save my choices" : "Save preferences"}</button><p role="status" id="ioExperienceStatus"></p></form>`,
    "experience",
  );
  wireNavbar();
  const form = root.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = new FormData(form),
        value = { ...p, onboardingDone: true };
      for (const k of ["genres", "avoidGenres"]) value[k] = data.getAll(k);
      for (const k of [
        "interfaceLanguage",
        "quality",
        "titleLanguage",
        "preferredAudio",
        "preferredSubtitles",
        "subtitleFont",
        "subtitleEffect",
      ])
        value[k] = data.get(k);
      for (const k of ["showIntro", "showOutro", "blurMature"])
        value[k] = data.has(k);
      for (const k of [
        "subtitleScale",
        "subtitleOpacity",
        "subtitleBackgroundOpacity",
      ])
        value[k] = Number(data.get(k));
      await ioJSON(
        "/api/experience/" + encodeURIComponent(profile.id),
        "PUT",
        value,
      );
      profile.experience = value;
      window.ioTranslateNavigation?.();
      root.querySelector("#ioExperienceStatus").textContent =
        "Preferences saved.";
    } catch (error) {
      root.querySelector("#ioExperienceStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
function ioPreferredTitle(item) {
  const lang = Store.activeProfile?.experience?.titleLanguage;
  return (
    item?.titles?.[lang] ||
    item?.[
      lang === "english"
        ? "titleEnglish"
        : lang === "romaji"
          ? "titleRomaji"
          : lang === "native"
            ? "titleNative"
            : "title"
    ] ||
    item?.title
  );
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = (active) =>
    nav(active).replace(
      "</nav>",
      '<a href="#/experience">Playback & subtitle preferences</a><a href="#/onboarding">Tailor recommendations</a></nav>',
    );
  const home = window.pageHome;
  window.pageHome = async function (root) {
    await ioLoadExperience();
    await home(root);
    if (
      !Store.activeProfile?.experience?.onboardingDone &&
      root.querySelector("#rows")
    ) {
      const notice = document.createElement("div");
      notice.className = "io-onboard-notice";
      notice.innerHTML =
        '<strong>What do you enjoy?</strong><span>Tailor your recommendations in a few choices.</span><a class="btn btn-primary" href="#/onboarding">Make I/O yours</a>';
      root.querySelector("#rows").prepend(notice);
    }
  };
  const inspired = window.computeInspiredByYou;
  window.computeInspiredByYou = function (limit) {
    const p = Store.activeProfile?.experience;
    if (!p) return inspired(limit);
    const blocked = new Set(p.avoidGenres.map((g) => g.toLowerCase())),
      liked = new Set(p.genres.map((g) => g.toLowerCase()));
    const titles = Store.filterForActiveProfile([
      ...Store.anime,
      ...Store.movies,
    ]).filter(
      (s) => !(s.genres || []).some((g) => blocked.has(g.toLowerCase())),
    );
    const originals = inspired(limit * 3);
    return titles
      .map((s) => ({
        s,
        score:
          (s.genres || []).reduce(
            (n, g) => n + (liked.has(g.toLowerCase()) ? 3 : 0),
            0,
          ) + (originals.includes(s) ? 2 : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.title.localeCompare(b.s.title))
      .slice(0, limit)
      .map((x) => x.s);
  };
  for (const key of ["animeCardHTML", "mangaCardHTML"]) {
    const card = window[key];
    window[key] = function (item, ...args) {
      const html = card({ ...item, title: ioPreferredTitle(item) }, ...args);
      return Store.activeProfile?.experience?.blurMature &&
        Store.isMatureRating(item.rating)
        ? html.replace('class="card', 'class="io-mature-blur card')
        : html;
    };
  }
  for (const [key, type] of [
    ["pageDetail", "anime"],
    ["pageMangaDetail", "manga"],
  ]) {
    const detail = window[key];
    window[key] = async function (root, id) {
      await detail(root, id);
      const item = type === "manga" ? Store.findManga(id) : Store.findAnime(id),
        heading = root.querySelector(".detail-info h1");
      if (item && heading) heading.textContent = ioPreferredTitle(item);
    };
  }
  const player = window.pagePlayer;
  window.pagePlayer = async function (root, id, ...args) {
    await ioLoadExperience();
    await player(root, id, ...args);
    const item = Store.findAnime(id),
      heading = root.querySelector("#playerTop .show-title");
    if (item && heading) heading.textContent = ioPreferredTitle(item);
  };
})();
