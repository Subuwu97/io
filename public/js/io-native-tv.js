async function ioPageTVPair(root, code) {
  const pairing = await API._fetch(
    "/api/tv-native/pair/" + encodeURIComponent(code),
  );
  root.innerHTML = ioSettingsShell(
    "Connect a TV",
    `<section class="io-settings-card"><h2>${escapeHtml(pairing.name)}</h2><p>Approve only if this code is currently displayed on your own TV: <strong>${escapeHtml(code)}</strong>. The TV can browse and play using the profile you choose. Revoke it from TV settings at any time.</p><form id="ioTVPairForm"><label>Viewing profile<select name="profileId">${Store.profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}</select></label><label>Profile PIN, if set<input name="pin" type="password" inputmode="numeric" autocomplete="off"></label><button class="btn btn-primary">Approve this TV</button></form><p role="status" id="ioTVPairStatus"></p></section>`,
    "tv-devices",
  );
  wireNavbar();
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      await ioJSON(
        "/api/tv-native/pair/" + encodeURIComponent(code) + "/approve",
        "POST",
        Object.fromEntries(new FormData(e.target)),
      );
      e.target.remove();
      root.querySelector("#ioTVPairStatus").textContent =
        "TV approved. You can return to your TV.";
    } catch (error) {
      root.querySelector("#ioTVPairStatus").textContent = error.message;
      button.disabled = false;
    }
  };
}
(function () {
  const page = window.ioPageTVDevices;
  if (!page) return;
  window.ioPageTVDevices = async function (root) {
    await page(root);
    const rows = await API._fetch("/api/tv-native/devices"),
      section = document.createElement("section");
    section.className = "io-settings-card";
    section.innerHTML =
      "<h2>Native TV apps</h2><p>Approve the pairing code shown by an I/O TV app from your signed-in phone or computer. Each device stays attached to its approved profile.</p><div>" +
      rows
        .map(
          (d) =>
            `<article class="io-inbox-item"><strong>${escapeHtml(d.name)}</strong><span>${escapeHtml(d.profileName)} · Last active ${escapeHtml(new Date(d.lastSeen).toLocaleString())}</span><button class="btn btn-secondary" data-native-revoke="${escapeHtml(d.id)}">Revoke TV</button></article>`,
        )
        .join("") +
      "</div>";
    root.querySelector(".io-settings-content").append(section);
    section.onclick = async (e) => {
      const button = e.target.closest("[data-native-revoke]");
      if (!button) return;
      button.disabled = true;
      try {
        await ioJSON(
          "/api/tv-native/devices/" +
            encodeURIComponent(button.dataset.nativeRevoke),
          "DELETE",
        );
        button.closest("article").remove();
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    };
  };
})();
