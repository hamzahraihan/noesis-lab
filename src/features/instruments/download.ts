/**
 * Hands text to the browser as a download.
 *
 * The bench writes files a person can keep -- a circuit, a capture, a table
 * of readings -- and the browser is the only thing here that can do that.
 * The anchor is put in the document before it is clicked, because Firefox
 * ignores a click on a detached one, and the URL is revoked late, because a
 * browser may still be reading the blob when the click returns.
 */
export function downloadText(text: string, name: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
