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
    if (!form || !textarea) return;
    const toolbar = document.createElement("div");
    toolbar.className = "io-rich-toolbar";
    toolbar.setAttribute("aria-label", "Comment formatting");
    toolbar.innerHTML =
      '<button type="button" data-format="**" aria-label="Bold">B</button><button type="button" data-format="*" aria-label="Italic"><em>I</em></button><button type="button" data-format="`" aria-label="Code">&lt;/&gt;</button><button type="button" data-format="~~" aria-label="Strikethrough"><s>S</s></button>';
    textarea.before(toolbar);
    const hint = document.createElement("small");
    hint.textContent =
      "Supports **bold**, *italic*, `code` and ~~strikethrough~~. HTML is displayed as text.";
    textarea.after(hint);
    toolbar.onclick = (e) => {
      const button = e.target.closest("[data-format]");
      if (!button) return;
      const marker = button.dataset.format,
        start = textarea.selectionStart,
        end = textarea.selectionEnd,
        selected = textarea.value.slice(start, end) || "text";
      textarea.setRangeText(marker + selected + marker, start, end, "select");
      textarea.focus();
    };
  };
})();
