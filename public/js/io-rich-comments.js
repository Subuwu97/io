function ioRichComment(text) {
  const tokens = String(text).split(
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~)/g,
  );
  return tokens
    .map((token) => {
      if (token.startsWith("`") && token.endsWith("`"))
        return "<code>" + escapeHtml(token.slice(1, -1)) + "</code>";
      if (token.startsWith("**") && token.endsWith("**"))
        return "<strong>" + escapeHtml(token.slice(2, -2)) + "</strong>";
      if (token.startsWith("*") && token.endsWith("*"))
        return "<em>" + escapeHtml(token.slice(1, -1)) + "</em>";
      if (token.startsWith("~~") && token.endsWith("~~"))
        return "<s>" + escapeHtml(token.slice(2, -2)) + "</s>";
      return escapeHtml(token);
    })
    .join("");
}
(function () {
  const mount = window.ioMountDiscussions;
  window.ioMountDiscussions = function (root, ...args) {
    mount(root, ...args);
    const form = root.querySelector("#ioDiscussionForm"),
      textarea = root.querySelector("#ioDiscussionText");
    if (!form || !textarea || !window.IOTiptap) return;
    const toolbar = document.createElement("div");
    toolbar.className = "io-rich-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Comment formatting");
    const commands = [
      ["Bold", "toggleBold"],
      ["Italic", "toggleItalic"],
      ["Underline", "toggleUnderline"],
      ["Strike", "toggleStrike"],
      ["Code", "toggleCode"],
      ["Bullet list", "toggleBulletList"],
      ["Numbered list", "toggleOrderedList"],
      ["Quote", "toggleBlockquote"],
      ["Code block", "toggleCodeBlock"],
      ["Undo", "undo"],
      ["Redo", "redo"],
    ];
    toolbar.innerHTML =
      commands
        .map(
          ([label, command]) =>
            `<button type="button" data-command="${command}" aria-label="${label}">${label}</button>`,
        )
        .join("") +
      '<button type="button" data-command="link">Link</button><button type="button" data-command="unlink">Remove link</button>';
    const host = document.createElement("div");
    host.className = "io-comment-editor";
    textarea.before(toolbar, host);
    textarea.hidden = true;
    textarea.required = false;
    const count = document.createElement("small");
    host.after(count);
    const editor = new IOTiptap.Editor({
      element: host,
      extensions: [
        IOTiptap.StarterKit.configure({
          heading: { levels: [2, 3] },
          link: { openOnClick: false, protocols: ["https", "http"] },
        }),
      ],
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Your comment",
          "aria-multiline": "true",
        },
      },
      onUpdate: () => {
        textarea.value = editor.getText();
        count.textContent = textarea.value.length + " / 2,000 characters";
      },
    });
    count.textContent = "0 / 2,000 characters";
    toolbar.onmousedown = (e) => e.preventDefault();
    toolbar.onclick = (e) => {
      const button = e.target.closest("[data-command]");
      if (!button) return;
      const cmd = button.dataset.command;
      if (cmd === "link") {
        const url = prompt("Link address (https:// or http://)");
        if (url && /^https?:\/\//i.test(url))
          editor.chain().focus().setLink({ href: url }).run();
      } else if (cmd === "unlink") editor.chain().focus().unsetLink().run();
      else editor.chain().focus()[cmd]().run();
    };
    const attachment = document.createElement("div");
    attachment.className = "io-comment-attachment";
    attachment.innerHTML =
      '<label>Attach GIF (up to 2 MB)<input type="file" accept="image/gif" aria-label="Attach GIF"></label><button type="button" hidden>Remove GIF</button><img hidden alt="Selected GIF preview"><span role="status"></span>';
    count.after(attachment);
    let gif = null,
      reading = false;
    const file = attachment.querySelector("input"),
      image = attachment.querySelector("img"),
      remove = attachment.querySelector("button"),
      status = attachment.querySelector("span");
    const clear = () => {
      gif = null;
      file.value = "";
      image.removeAttribute("src");
      image.hidden = true;
      remove.hidden = true;
      status.textContent = "";
    };
    remove.onclick = clear;
    file.onchange = async () => {
      const selected = file.files[0];
      clear();
      if (!selected) return;
      if (selected.size > 2 * 1024 * 1024 || selected.type !== "image/gif") {
        status.textContent = "Choose a GIF smaller than 2 MB";
        return;
      }
      reading = true;
      try {
        gif = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(selected);
        });
        image.src = gif;
        image.hidden = false;
        remove.hidden = false;
        status.textContent = "GIF ready to post";
      } catch {
        status.textContent = "Could not read this GIF";
      } finally {
        reading = false;
      }
    };
    form.ioRichPayload = () => {
      if (reading) throw Error("Wait for the GIF to finish loading");
      return { richHtml: editor.getHTML(), gif };
    };
    form.addEventListener("reset", () => {
      editor.commands.clearContent();
      clear();
    });
    const observer = new MutationObserver(() => {
      if (!host.isConnected) {
        observer.disconnect();
        editor.destroy();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener(
      "hashchange",
      () => {
        observer.disconnect();
        if (!editor.isDestroyed) editor.destroy();
      },
      { once: true },
    );
  };
})();
