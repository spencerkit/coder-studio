export async function copyTextWithFallback(text: string): Promise<void> {
  let clipboardError: unknown;

  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (error) {
    clipboardError = error;
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    throw clipboardError ?? new Error("Clipboard copy unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    if (!document.execCommand("copy")) {
      throw clipboardError ?? new Error("Clipboard copy unavailable");
    }
  } finally {
    textarea.remove();
  }
}
