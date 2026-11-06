let ioCustomHeroEntry = null;
const ioHeroOriginalHome = pageHome;
pageHome = async function (root) {
  const hash = location.hash;
  const entry = await API._fetch("/api/home-hero").catch(() => null);
  if (location.hash !== hash) return;
  ioCustomHeroEntry = entry;
  return ioHeroOriginalHome(root);
};
const ioHeroOriginalSettings = pageSettings;
pageSettings = async function (root) {
  await ioHeroOriginalSettings(root);
  if (Store.account?.role !== "admin" || location.hash !== "#/settings") return;
  const value = await API._fetch("/api/home-hero/manage").catch(() => null);
  if (location.hash !== "#/settings") return;
  const section = document.createElement("section");
  section.className = "io-settings-card";
  section.innerHTML = `<h2>Custom home banner</h2><p>Add an image to the rotating featured media banner. Position 1 shows it first; later positions follow the available media. Use artwork suitable for every viewing profile. Landscape images around 1920 × 1080 work best.</p><form><label style="display:flex;align-items:center;gap:10px"><input style="width:auto" name="enabled" type="checkbox"> Show custom entry</label><label>Position in rotation<input name="position" type="number" min="1" max="6" value="1"></label><label>Title (optional)<input name="title" maxlength="100"></label><label>Description (optional)<textarea name="description" maxlength="400"></textarea></label><label>Banner image (PNG or JPEG, up to 2 MB)<input name="image" type="file" accept="image/png,image/jpeg"></label><img alt="Custom banner preview" style="display:none;width:100%;max-width:640px;max-height:300px;object-fit:contain"><button class="btn btn-primary">Save custom banner</button><p role="status"></p></form>`;
  root.querySelector(".io-settings-content")?.append(section);
  const form = section.querySelector("form"),
    status = form.querySelector("[role=status]"),
    preview = form.querySelector("img");
  let image = value?.image || "";
  for (const key of ["title", "description", "position"])
    if (value) form.elements[key].value = value[key];
  form.elements.enabled.checked = !!value?.enabled;
  function show() {
    preview.src = image;
    preview.style.display = image ? "block" : "none";
  }
  show();
  form.elements.image.onchange = async () => {
    const file = form.elements.image.files[0];
    if (!file) return;
    if (
      file.size > 2097152 ||
      !["image/png", "image/jpeg"].includes(file.type)
    ) {
      status.textContent = "Choose a PNG or JPEG under 2 MB";
      return;
    }
    image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    show();
    status.textContent = "Image ready. Save to add it to the rotation.";
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    status.textContent = "Saving…";
    try {
      await API._fetch("/api/home-hero/manage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: form.elements.enabled.checked,
          position: Number(form.elements.position.value),
          title: form.elements.title.value,
          description: form.elements.description.value,
          image,
        }),
      });
      status.textContent =
        "Custom banner saved. Open Home to see the rotation.";
    } catch (e) {
      status.textContent = e.message;
    }
  };
};
