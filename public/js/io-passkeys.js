async function ioPagePasskeys(root) {
  const route = location.hash;
  const keys = await API._fetch("/api/passkeys");
  if (route !== location.hash) return;
  root.innerHTML = ioSettingsShell(
    "Passkeys",
    `<section class="io-settings-card"><h2>Sign in with your device</h2><p>Use your fingerprint, face, device PIN or security key. Register passkeys separately for each I/O web address. Keep your password available for recovery and sensitive changes.</p><div id="ioPasskeyList">${keys.length ? keys.map((k) => `<article class="io-inbox-item"><div><strong>${escapeHtml(k.name)}</strong><small>Added ${escapeHtml(new Date(k.createdAt).toLocaleDateString())}${k.lastUsed ? " · Last used " + escapeHtml(new Date(k.lastUsed).toLocaleDateString()) : ""}</small></div><button class="btn btn-secondary" data-remove-key="${escapeHtml(k.id)}">Remove</button></article>`).join("") : "<p>No passkeys registered.</p>"}</div><form id="ioPasskeyForm"><label>Passkey name<input id="ioPasskeyName" maxlength="80" placeholder="My phone"></label>${ioProofFields()}<button class="btn btn-primary">Add a passkey</button></form><p id="ioPasskeyStatus" role="status"></p></section>`,
    "passkeys",
  );
  wireNavbar();
  const status = root.querySelector("#ioPasskeyStatus");
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      if (!window.PublicKeyCredential)
        throw Error(
          "This browser requires HTTPS or localhost and passkey support",
        );
      const options = await ioJSON(
        "/api/passkeys/register/options",
        "POST",
        ioProof(root),
      );
      const response = await SimpleWebAuthnBrowser.startRegistration({
        optionsJSON: options,
      });
      await ioJSON("/api/passkeys/register/verify", "POST", {
        response,
        name: root.querySelector("#ioPasskeyName").value,
      });
      await ioPagePasskeys(root);
      showToast("Passkey added");
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  };
  root.querySelector("#ioPasskeyList").onclick = async (e) => {
    const button = e.target.closest("[data-remove-key]");
    if (!button) return;
    button.disabled = true;
    try {
      await ioJSON("/api/passkeys/remove", "POST", {
        id: button.dataset.removeKey,
        ...ioProof(root),
      });
      await ioPagePasskeys(root);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  };
}
(function () {
  const nav = window.ioSettingsNav;
  window.ioSettingsNav = (active) =>
    nav(active).replace("</nav>", '<a href="#/passkeys">Passkeys</a></nav>');
  const auth = window.pageAuthGate;
  window.pageAuthGate = async function (root) {
    await auth(root);
    const form = root.querySelector("#authFormView");
    if (!form || !Store.hasAnyAccounts || !window.PublicKeyCredential) return;
    const button = document.createElement("button");
    button.className = "login-qr-btn";
    button.textContent = "Sign in with a passkey";
    button.type = "button";
    form.append(button);
    button.onclick = async () => {
      button.disabled = true;
      try {
        const options = await ioJSON("/api/auth/passkeys/options", "POST", {});
        const response = await SimpleWebAuthnBrowser.startAuthentication({
          optionsJSON: options,
        });
        await ioJSON("/api/auth/passkeys/verify", "POST", { response });
        await Store.init();
        location.hash = "#/";
        renderApp();
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
    };
  };
})();
