async function ioPageAccountData(root) {
  root.innerHTML = ioSettingsShell(
    "Your data & account",
    `<section class="io-settings-card"><h2>Export your data</h2><p>Download a private ZIP containing your profiles, lists, viewing/reading progress, reviews, discussions and saved preferences. Passwords, passkeys, sessions and service credentials are excluded.</p>${ioProofFields()}<button class="btn btn-primary" id="ioExportAccount">Download my data</button><hr><h2>Delete your account</h2><p>This permanently removes your account, household profiles, progress, lists and authored discussions. Media files remain on the server. The last administrator must transfer that role before deleting their account.</p><label>Type your exact username to confirm<input id="ioDeleteConfirmation" autocomplete="off" placeholder="${escapeHtml(Store.account.username)}"></label><label class="io-checkbox-row"><input type="checkbox" id="ioDeleteUnderstand">I understand that this cannot be undone</label><button class="btn btn-secondary" id="ioDeleteAccount">Permanently delete my account</button><p role="status" id="ioDataStatus"></p></section>`,
    "account-data",
  );
  wireNavbar();
  const status = root.querySelector("#ioDataStatus");
  root.querySelector("#ioExportAccount").onclick = async (e) => {
    const button = e.target;
    button.disabled = true;
    try {
      const response = await fetch("/api/account-data/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ioProof(root)),
      });
      if (!response.ok) throw Error((await response.json()).error);
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "I-O-account.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = "Your export is ready. Keep it private.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  root.querySelector("#ioDeleteAccount").onclick = async (e) => {
    if (!root.querySelector("#ioDeleteUnderstand").checked) {
      status.textContent =
        "Confirm that you understand deletion cannot be undone.";
      return;
    }
    const button = e.target;
    button.disabled = true;
    try {
      await ioJSON("/api/account-data/delete", "POST", {
        ...ioProof(root),
        confirmation: root.querySelector("#ioDeleteConfirmation").value,
      });
      await Store.init();
      location.hash = "#/";
      renderApp();
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  };
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = (active) =>
    nav(active).replace(
      "</nav>",
      '<a href="#/account-data">Your data & account</a></nav>',
    );
})();
