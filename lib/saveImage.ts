// Saving an image from the web app. A web page can't write to the phone's photo
// library directly, and on iPhone `<a download>` only opens a file preview, so
// phones get the share sheet with the image file, whose "Save Image" puts it in
// Photos. Computers get a normal download. A cross-origin URL (Supabase Storage)
// ignores `download` and just opens the image, so it's fetched as a blob first.

const blobCache = new Map<string, Promise<Blob>>();

/**
 * Starts fetching an image so a later save can share it immediately: iOS only
 * allows the share sheet within a moment of the tap, and a slow fetch after the
 * tap loses that. Call it when the photo is shown.
 */
export function prefetchImage(url: string): Promise<Blob> {
  let p = blobCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    });
    p.catch(() => blobCache.delete(url));
    blobCache.set(url, p);
    if (blobCache.size > 20) blobCache.delete(blobCache.keys().next().value!);
  }
  return p;
}

function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}

function withExtension(name: string, type: string): string {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name || "travelries"}.${ext}`;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves an image: the share sheet on phones (→ "Save Image"), a download elsewhere. */
export async function saveImage(source: Blob | string, fileName: string): Promise<void> {
  let blob: Blob;
  try {
    blob = typeof source === "string" ? await prefetchImage(source) : source;
  } catch {
    if (typeof source === "string") window.open(source, "_blank"); // CORS/network failure: at least show it
    return;
  }
  const name = withExtension(fileName, blob.type);
  if (isPhone()) {
    const file = new File([blob], name, { type: blob.type || "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // closed the sheet
        // NotAllowedError (the tap was too long ago) etc. → fall back to a download
      }
    }
  }
  download(blob, name);
}
