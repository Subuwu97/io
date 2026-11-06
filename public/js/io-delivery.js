async function ioPageDelivery(root) {
  const route = location.hash;
  const data = await API._fetch("/api/notification-delivery");
  if (route !== location.hash) return;
  const labels = {
    episodes: "New episodes & chapters",
    seasons: "New seasons",
    upcoming: "Upcoming titles",
    announcements: "Announcements",
  };
  root.innerHTML = ioSettingsShell(
    "Notification categories",
    `<form class="io-settings-card" id="ioDeliveryForm"><p>Choose how I/O sends each kind of update. Email needs a verified address and configured mail service. Discord delivery posts to a webhook you control; anyone with access to that channel can see those updates.</p><div class="io-notification-matrix"><table><thead><tr><th>Category</th><th>In I/O</th><th>Email</th><th>Discord</th></tr></thead><tbody>${Object.entries(
      labels,
    )
      .map(
        ([key, label]) =>
          `<tr><th>${label}</th>${["inapp", "email", "discord"].map((c) => `<td><input type="checkbox" name="${key}-${c}" aria-label="${label}: ${c}" ${data.preferences[key][c] ? "checked" : ""} ${c === "email" && !data.emailReady ? "disabled" : ""}></td>`).join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><label>Discord webhook address<input name="webhook" type="password" autocomplete="new-password" placeholder="${data.webhookConfigured ? "Configured — leave blank to keep" : "https://discord.com/api/webhooks/…"}"></label><label class="io-checkbox-row"><input type="checkbox" name="removeWebhook">Remove saved webhook</label><button class="btn btn-primary">Save notification choices</button><p id="ioDeliveryStatus" role="status"></p><h2>Recent delivery attempts</h2>${data.recent.map((j) => `<p>${escapeHtml(j.channel)} · ${escapeHtml(j.status)}${j.error ? " · " + escapeHtml(j.error) : ""}</p>`).join("") || "<p>No delivery attempts yet.</p>"}<p><a href="#/community-notifications">Reply and reaction notifications</a> have their own preference.</p></form>`,
    "delivery",
  );
  wireNavbar();
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    try {
      await ioJSON("/api/notification-delivery", "PUT", {
        preferences: Object.fromEntries(
          Object.keys(labels).map((k) => [
            k,
            Object.fromEntries(
              ["inapp", "email", "discord"].map((c) => [c, d.has(k + "-" + c)]),
            ),
          ]),
        ),
        webhook: d.get("webhook"),
        removeWebhook: d.has("removeWebhook"),
      });
      root.querySelector("#ioDeliveryStatus").textContent =
        "Notification choices saved.";
    } catch (error) {
      root.querySelector("#ioDeliveryStatus").textContent = error.message;
    }
  };
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = (active) =>
    nav(active).replace(
      "</nav>",
      '<a href="#/notification-delivery">Notification categories</a></nav>',
    );
})();
