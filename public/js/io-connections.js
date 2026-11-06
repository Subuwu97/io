async function ioPageConnections(root) {
  const profile = Store.activeProfile,
    route = location.hash,
    data = await API._fetch(
      "/api/people/connections/" + encodeURIComponent(profile.id),
    );
  if (location.hash !== route) return;
  const labels = {
    incoming: "Incoming requests",
    outgoing: "Sent requests",
    friends: "Friends",
    following: "Following",
  };
  root.innerHTML = ioSettingsShell(
    "Friends, follows & blocks",
    `<section class="io-settings-card"><p>Connections belong to this viewing profile. Blocking covers the entire account and clears friendships and follows in both directions.</p><a href="#/people">Discover people</a>${Object.entries(
      labels,
    )
      .map(
        ([key, label]) =>
          `<h2>${label}</h2>${
            data.items
              .filter((r) =>
                key === "following" ? r.following : r.friendship === key,
              )
              .map(
                (r) =>
                  `<article class="io-inbox-item"><a href="#/people/${encodeURIComponent(r.slug)}">${escapeHtml(r.name)} @${escapeHtml(r.slug)}</a><div class="io-dialog-actions">${(key ===
                  "incoming"
                    ? [
                        ["accept", "Accept"],
                        ["decline", "Decline"],
                      ]
                    : key === "outgoing"
                      ? [["cancel", "Cancel"]]
                      : key === "friends"
                        ? [["unfriend", "Remove friend"]]
                        : [["unfollow", "Unfollow"]]
                  )
                    .map(
                      ([action, label]) =>
                        `<button class="btn btn-secondary" data-slug="${escapeHtml(r.slug)}" data-action="${action}">${label}</button>`,
                    )
                    .join("")}</div></article>`,
              )
              .join("") || "<p>No connections in this section.</p>"
          }`,
      )
      .join(
        "",
      )}<h2>Blocked accounts</h2>${data.blocks.map((b) => `<article class="io-inbox-item"><strong>${escapeHtml(b.name)}</strong><button class="btn btn-secondary" data-unblock="${b.ref}">Unblock</button></article>`).join("") || "<p>No blocked accounts.</p>"}<p id="ioConnectionsStatus" role="status"></p></section>`,
    "connections",
  );
  wireNavbar();
  root.querySelector(".io-settings-content").onclick = async (e) => {
    const button = e.target.closest("[data-action],[data-unblock]");
    if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.unblock)
        await API._fetch("/api/people/blocks/" + button.dataset.unblock, {
          method: "DELETE",
        });
      else
        await ioJSON(
          "/api/people/u/" +
            encodeURIComponent(button.dataset.slug) +
            "/relationship",
          "POST",
          { profileId: profile.id, action: button.dataset.action },
        );
      await ioPageConnections(root);
    } catch (error) {
      root.querySelector("#ioConnectionsStatus").textContent = error.message;
      button.disabled = false;
    }
  };
}
