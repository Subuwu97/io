async function ioPagePeople(root, slug) {
  const hash = location.hash;
  root.innerHTML = ioSettingsShell(
    slug ? "Community profile" : "Discover people",
    '<section class="io-settings-card" id="ioPeopleContent"><p role="status">Loading…</p></section>',
    "people",
  );
  wireNavbar();
  const content = root.querySelector("#ioPeopleContent");
  try {
    if (slug) {
      const p = await API._fetch(
        "/api/people/u/" +
          encodeURIComponent(slug) +
          "?viewer=" +
          encodeURIComponent(Store.activeProfile.id),
      );
      if (location.hash !== hash) return;
      const cards = (items) =>
        items
          .map(
            (t) =>
              `<a class="io-person-title" href="#/${t.type === "manga" ? "manga" : "title"}/${encodeURIComponent(t.id)}">${escapeHtml(t.title)}${t.status ? " · " + escapeHtml(ioListLabel(t.status, t.type)) : ""}</a>`,
          )
          .join("");
      content.innerHTML = `<a href="#/people">‹ Discover people</a><div class="io-person-heading"><img src="${escapeHtml(p.avatar)}" width="80" height="80" alt=""><div><h2>${escapeHtml(p.name)}</h2><p>@${escapeHtml(p.slug)}</p></div></div><p class="io-person-bio">${escapeHtml(p.bio)}</p>${p.owner ? '<a href="#/public-profile">Edit privacy & profile</a>' : ""}${p.statistics ? `<h3>Statistics</h3><p>${p.statistics.watchedHours} hours watched · ${p.statistics.completedTitles} completed titles</p>` : ""}${p.list ? "<h3>My List</h3>" + (cards(p.list) || "<p>No shared titles yet.</p>") : ""}${p.favorites ? "<h3>Favorites</h3>" + cards(p.favorites.titles) + "<p>" + p.favorites.characters.map(escapeHtml).join(" · ") + "</p>" : ""}${p.reviews ? "<h3>Reviews</h3>" + p.reviews.map((r) => `<article class="io-people-review"><h4>${escapeHtml(r.title)} · ${escapeHtml(String(r.rating))}/10</h4><p>${escapeHtml(r.text)}</p></article>`).join("") : ""}${p.links ? "<h3>Social links</h3>" + p.links.map((l) => `<p><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)} ↗</a></p>`).join("") : ""}`;
      if (!p.owner) {
        const actions = document.createElement("div");
        actions.className = "io-dialog-actions";
        const r = p.relationship;
        actions.innerHTML =
          '<button class="btn btn-secondary" data-person-action="' +
          (r.following ? "unfollow" : "follow") +
          '">' +
          (r.following ? "Unfollow" : "Follow") +
          "</button>" +
          ({
            none: '<button class="btn btn-primary" data-person-action="request">Add friend</button>',
            outgoing:
              '<button class="btn btn-secondary" data-person-action="cancel">Cancel friend request</button>',
            incoming:
              '<button class="btn btn-primary" data-person-action="accept">Accept friend request</button><button class="btn btn-secondary" data-person-action="decline">Decline</button>',
            friends:
              '<button class="btn btn-secondary" data-person-action="unfriend">Remove friend</button>',
          }[r.friendship] || "") +
          '<button class="btn-ghost" data-person-action="block">Block account</button><a href="#/connections">My connections</a><p role="status"></p>';
        content.querySelector(".io-person-bio").after(actions);
        actions.onclick = async (e) => {
          const b = e.target.closest("[data-person-action]");
          if (!b) return;
          b.disabled = true;
          try {
            await ioJSON(
              "/api/people/u/" + encodeURIComponent(slug) + "/relationship",
              "POST",
              {
                profileId: Store.activeProfile.id,
                action: b.dataset.personAction,
              },
            );
            if (b.dataset.personAction === "block")
              location.hash = "#/connections";
            else await ioPagePeople(root, slug);
          } catch (error) {
            actions.querySelector("[role=status]").textContent = error.message;
            b.disabled = false;
          }
        };
      }
    } else {
      content.innerHTML =
        '<form id="ioPeopleSearch"><label for="ioPeopleQuery">Search public usernames or display names</label><div class="io-dialog-actions"><input id="ioPeopleQuery" type="search" maxlength="80"><button class="btn btn-primary">Search</button></div></form><p>Only profiles that choose to appear here are listed. <a href="#/public-profile">Manage your visibility</a></p><div id="ioPeopleResults" class="io-people-grid"></div><button class="btn btn-secondary" id="ioPeopleMore" hidden>Load more</button><p id="ioPeopleStatus" role="status"></p>';
      let page = 0,
        q = "",
        generation = 0;
      const results = content.querySelector("#ioPeopleResults"),
        more = content.querySelector("#ioPeopleMore"),
        status = content.querySelector("#ioPeopleStatus");
      async function load(append = false) {
        const g = ++generation;
        more.disabled = true;
        try {
          const data = await API._fetch(
            "/api/people?q=" + encodeURIComponent(q) + "&page=" + page,
          );
          if (!content.isConnected || g !== generation) return;
          const markup = data.items
            .map(
              (p) =>
                `<a class="io-person-card" href="#/people/${encodeURIComponent(p.slug)}"><img src="${escapeHtml(p.avatar)}" width="56" height="56" alt=""><strong>${escapeHtml(p.name)}</strong><span>@${escapeHtml(p.slug)}</span><p>${escapeHtml(p.bio)}</p></a>`,
            )
            .join("");
          if (append) results.insertAdjacentHTML("beforeend", markup);
          else results.innerHTML = markup;
          more.hidden = !data.hasMore;
          status.textContent = results.children.length
            ? ""
            : "No discoverable profiles match yet.";
        } catch (e) {
          status.textContent = e.message;
        } finally {
          more.disabled = false;
        }
      }
      content.querySelector("form").onsubmit = (e) => {
        e.preventDefault();
        q = content.querySelector("input").value;
        page = 0;
        load();
      };
      more.onclick = () => {
        page++;
        load(true);
      };
      await load();
    }
  } catch (e) {
    if (content.isConnected) content.textContent = e.message;
  }
}
async function ioPagePublicProfile(root) {
  const profile = Store.activeProfile,
    hash = location.hash;
  const p = await API._fetch(
    "/api/people/settings/" + encodeURIComponent(profile.id),
  );
  if (location.hash !== hash) return;
  const sections = {
    list: "My List and statuses",
    favorites: "Favorite titles and characters",
    reviews: "Reviews",
    statistics: "Viewing statistics",
    social: "Social links",
  };
  root.innerHTML = ioSettingsShell(
    "Public profile & privacy",
    `<form id="ioPublicForm" class="io-settings-card"><p>Your viewing profile stays private by default. Sharing is limited to the sections you enable below. Public pages are visible to signed-in I/O members; mature titles are excluded.</p><label>Public username<input name="slug" value="${escapeHtml(p.slug)}" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}" required minlength="3" maxlength="32"></label><label>Visibility<select name="visibility"><option value="private">Private — only your account</option><option value="unlisted">Unlisted — members with your link</option><option value="friends">Friends — sections only for accepted friends</option><option value="public">Public — members with your link</option></select></label><label class="io-checkbox-row"><input type="checkbox" name="discoverable" ${p.discoverable ? "checked" : ""}>Include in user discovery when public</label>${profile.isKids ? "<p>Kids profiles must stay private.</p>" : ""}<label>About you<textarea name="bio" maxlength="1000">${escapeHtml(p.bio)}</textarea></label><fieldset><legend>Shared sections</legend>${Object.entries(
      sections,
    )
      .map(
        ([k, v]) =>
          `<label>${v}<select name="privacy-${k}">${[
            ["private", "Only me"],
            ["members", "All signed-in members"],
            ["followers", "People who follow me"],
            ["friends", "Accepted friends"],
          ]
            .map(
              ([value, label]) =>
                `<option value="${value}" ${(p.privacy[k] === true ? "members" : p.privacy[k] === false ? "private" : p.privacy[k]) === value ? "selected" : ""}>${label}</option>`,
            )
            .join("")}</select></label>`,
      )
      .join(
        "",
      )}</fieldset><label>Favorite characters — one per line, up to 12<textarea name="characters">${escapeHtml(p.characters.join("\n"))}</textarea></label><label>Social links — one per line: Label | https://address<textarea name="links" placeholder="Website | https://example.com">${escapeHtml(p.links.map((l) => l.label + " | " + l.url).join("\n"))}</textarea></label><p>Playback positions, account identifiers, email, private settings and household profiles are never shared.</p><div class="io-dialog-actions"><button class="btn btn-primary">Save profile & privacy</button>${p.slug ? `<a href="#/people/${encodeURIComponent(p.slug)}">View shared profile</a>` : ""}<a href="#/people">Discover people</a></div><p id="ioPublicStatus" role="status"></p></form>`,
    "public-profile",
  );
  wireNavbar();
  const form = root.querySelector("form");
  form.elements.visibility.value = p.visibility;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const status = root.querySelector("#ioPublicStatus"),
      button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = new FormData(form),
        links = String(data.get("links"))
          .split("\n")
          .filter((s) => s.trim())
          .map((s) => {
            const index = s.indexOf("|");
            return {
              label: s.slice(0, index).trim(),
              url: s.slice(index + 1).trim(),
            };
          });
      await ioJSON(
        "/api/people/settings/" + encodeURIComponent(profile.id),
        "PUT",
        {
          slug: data.get("slug"),
          visibility: data.get("visibility"),
          discoverable: data.has("discoverable"),
          bio: data.get("bio"),
          characters: String(data.get("characters"))
            .split("\n")
            .filter((s) => s.trim()),
          links,
          privacy: Object.fromEntries(
            Object.keys(sections).map((k) => [k, data.get("privacy-" + k)]),
          ),
        },
      );
      status.textContent = "Profile and privacy saved.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = function (active) {
    return nav(active).replace(
      "</nav>",
      '<a href="#/public-profile">Public profile & privacy</a><a href="#/people">Discover people</a><a href="#/connections">Friends, follows & blocks</a></nav>',
    );
  };
  const navbar = window.renderNavbar;
  window.renderNavbar = function (active) {
    return navbar(active).replace(
      '<li class="divider">',
      '<li><a href="#/people">Discover people</a></li><li><a href="#/public-profile">Public profile & privacy</a></li><li class="divider">',
    );
  };
})();
