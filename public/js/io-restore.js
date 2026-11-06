async function ioReadAccountExport(file) {
  if (!file || file.size > 10 * 1024 * 1024)
    throw Error("Choose an I/O export smaller than 10 MB");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    if (file.size > 5 * 1024 * 1024)
      throw Error("The account JSON must be smaller than 5 MB");
    return JSON.parse(await file.text());
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    let found = false,
      done = false;
    const unzip = new fflate.Unzip((entry) => {
      if (entry.name !== "I-O-account.json") return;
      found = true;
      if (entry.originalSize > 5 * 1024 * 1024) {
        done = true;
        reject(Error("The account JSON is too large"));
        return;
      }
      let length = 0,
        chunks = [];
      entry.ondata = (error, chunk, final) => {
        if (done) return;
        if (error) {
          done = true;
          reject(Error("Could not read this ZIP"));
          return;
        }
        length += chunk.length;
        if (length > 5 * 1024 * 1024) {
          done = true;
          entry.terminate();
          reject(Error("The account JSON is too large"));
          return;
        }
        chunks.push(chunk);
        if (final) {
          done = true;
          try {
            const content = new Uint8Array(length);
            let offset = 0;
            for (const c of chunks) {
              content.set(c, offset);
              offset += c.length;
            }
            resolve(JSON.parse(new TextDecoder().decode(content)));
          } catch {
            reject(Error("Invalid account export JSON"));
          }
        }
      };
      entry.start();
    });
    unzip.register(fflate.UnzipInflate);
    try {
      for (let i = 0; i < bytes.length && !done; i += 1024)
        unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
      if (!found) reject(Error("This ZIP does not contain I-O-account.json"));
      else if (!done) {
        done = true;
        reject(Error("This ZIP is incomplete"));
      }
    } catch {
      reject(Error("Could not read this I/O export"));
    }
  });
}
function ioMountRestore(root) {
  const section = document.createElement("section");
  section.className = "io-settings-card";
  section.innerHTML =
    '<h2>Restore a personal export</h2><p>Choose an I/O ZIP or its account JSON. Restore lists, favorites, playback/reading progress and preferences into one of your profiles. Posted comments, account credentials and public sharing settings are not imported.</p><label>Account export<input type="file" id="ioRestoreFile" accept=".zip,.json"></label><label>Source profile<select id="ioRestoreSource" disabled></select></label><label>Destination profile<select id="ioRestoreTarget">' +
    Store.profiles
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}" ${p.id === Store.activeProfile.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`,
      )
      .join("") +
    '</select></label><label>Existing entries<select id="ioRestoreMode"><option value="merge">Keep current entries when both exist</option><option value="replace-conflicts">Use archived entries when both exist</option></select></label><button class="btn btn-primary" id="ioRestorePreview" disabled>Preview restore</button><div id="ioRestorePlan"></div><p id="ioRestoreStatus" role="status"></p>';
  root.querySelector(".io-settings-content").append(section);
  let data;
  const status = section.querySelector("#ioRestoreStatus"),
    preview = section.querySelector("#ioRestorePreview");
  section.querySelector("#ioRestoreFile").onchange = async (e) => {
    preview.disabled = true;
    section.querySelector("#ioRestorePlan").replaceChildren();
    try {
      data = await ioReadAccountExport(e.target.files[0]);
      if (
        data.formatVersion !== 1 ||
        !Array.isArray(data.profiles) ||
        data.profiles.length > 5
      )
        throw Error("Choose a supported I/O export");
      section.querySelector("#ioRestoreSource").innerHTML = data.profiles
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`,
        )
        .join("");
      section.querySelector("#ioRestoreSource").disabled = false;
      preview.disabled = false;
      status.textContent =
        "Export loaded locally. Confirm your current password above before previewing.";
    } catch (error) {
      data = null;
      status.textContent = error.message;
    }
  };
  preview.onclick = async () => {
    preview.disabled = true;
    try {
      const result = await ioJSON("/api/account-data/restore/preview", "POST", {
        ...ioProof(root),
        data,
        sourceId: section.querySelector("#ioRestoreSource").value,
        targetId: section.querySelector("#ioRestoreTarget").value,
        mode: section.querySelector("#ioRestoreMode").value,
      });
      const plan = section.querySelector("#ioRestorePlan");
      plan.innerHTML = `<div class="io-sync-plan"><h3>Review restore</h3><p>From ${escapeHtml(result.sourceAccount)} / ${escapeHtml(result.sourceName)} → ${escapeHtml(result.targetName)}</p><p>${Object.entries(
        result.counts,
      )
        .map(([k, n]) => escapeHtml(k) + ": " + n)
        .join(
          " · ",
        )}</p><p>${result.skipped} unavailable or invalid entries skipped. ${result.preferences ? "Preferences included." : ""}</p><p>${result.mode === "merge" ? "Existing entries stay unchanged." : "Archived entries replace matching current entries."}</p><button class="btn btn-primary" id="ioRestoreApply">Apply this restore</button></div>`;
      plan.querySelector("button").onclick = async (e) => {
        e.target.disabled = true;
        try {
          await ioJSON("/api/account-data/restore/apply", "POST", {
            ...ioProof(root),
            planId: result.id,
          });
          plan.replaceChildren();
          status.textContent = "Restore completed.";
          await Store.loadAfterLogin();
        } catch (error) {
          status.textContent = error.message;
          e.target.disabled = false;
        }
      };
    } catch (error) {
      status.textContent = error.message;
    } finally {
      preview.disabled = false;
    }
  };
}
(function () {
  const original = window.ioPageAccountData;
  window.ioPageAccountData = async function (root) {
    await original(root);
    ioMountRestore(root);
    const button = document.createElement("button");
    button.className = "btn btn-secondary";
    button.textContent = "Email my export to my verified address";
    root.querySelector("#ioExportAccount").after(button);
    button.onclick = async () => {
      button.disabled = true;
      try {
        await ioJSON("/api/account-data/email", "POST", ioProof(root));
        root.querySelector("#ioDataStatus").textContent =
          "Export sent to your verified email address.";
      } catch (error) {
        root.querySelector("#ioDataStatus").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  };
})();
