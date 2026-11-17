/**
 * Copies text to the clipboard. Falls back to a hidden textarea and
 * execCommand where the Clipboard API is missing or refused (older browsers,
 * plain-HTTP origins, denied permission). Resolves false if both fail.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused or unavailable here: the legacy path below may still work.
    }
  }
  return copyWithHiddenTextarea(text);
}

function copyWithHiddenTextarea(text: string): boolean {
  if (typeof document === "undefined") return false;

  const previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  // Off-screen but selectable; 12pt stops iOS zooming in on focus.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.fontSize = "12pt";

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let isCopied = false;
  try {
    isCopied = document.execCommand("copy");
  } catch {
    isCopied = false;
  }

  document.body.removeChild(textarea);
  // Selecting the textarea moved focus; give it back to the Copy button.
  previouslyFocused?.focus();
  return isCopied;
}
