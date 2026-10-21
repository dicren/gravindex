/**
 * Triggers a browser "Save As" for bytes that already live in memory — no
 * `<a>` in any template, no URL for the browser to navigate to.
 *
 * ⚠️ **Why not `<a :href :download>` in a template.** That works for a URL the
 * browser can fetch on its own; it does nothing for bytes this app already
 * holds (`DownloadClipAudioUseCase`'s cut mp3). A `Blob` URL plus a
 * programmatic click is the whole trick, and it belongs in one place rather
 * than four — one per component that offers a download.
 */
export function saveFile(bytes: Uint8Array, filename: string, mimeType: string): void {
  // ⚠️ `Uint8Array` alone types as `ArrayBufferLike`-backed (it could be a
  // `SharedArrayBuffer`'s view), which `BlobPart` refuses even though nothing
  // here ever hands one over. Copying into a fresh `Uint8Array` gives back an
  // ordinary `ArrayBuffer` the type checker can see is safe.
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Never inserted visibly — `.click()` works on a detached element, and
    // this is gone again before the next tick either way.
    anchor.click();
  } finally {
    // ⚠️ Deferred, not immediate: revoking the URL before the browser has
    // actually started the save can cancel it in some browsers. The download
    // has already been handed off by the time this runs.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
