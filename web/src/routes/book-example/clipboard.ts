// Copy text to the clipboard via the async Clipboard API (book embeds
// grant it through the iframe's `clipboard-write` permission). Resolves
// true on success, false otherwise — never throws, so UI code stays simple.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
