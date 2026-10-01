import { translate, currentLang } from "./i18n";
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
  // Safari can still be reading the blob a while after the click; revoking early breaks the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// A small status pill at the top of the screen. A computer download lands in
// the Downloads folder silently (Safari only twitches its toolbar icon), so
// without this, Save looked like it did nothing.
let toastEl: HTMLDivElement | null = null;
const t = (en: string, vars?: Record<string, string>) => translate(currentLang(), en, vars);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, ms = 2600) {
  if (typeof document === "undefined") return;
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.setAttribute("role", "status");
    toastEl.style.cssText =
      "position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 16px);transform:translateX(-50%);" +
      "z-index:6000;background:rgba(15,23,42,.92);color:#fff;font:600 14px/1.3 Pretendard,system-ui,sans-serif;" +
      "padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;" +
      "max-width:calc(100vw - 32px);text-align:center;transition:opacity .2s";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.opacity = "1";
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = "0"; }, ms);
}

/** Saves an image: the share sheet on phones (→ "Save Image"), a download elsewhere. */
export async function saveImage(source: Blob | string, fileName: string): Promise<void> {
  let blob: Blob;
  const slow = setTimeout(() => toast(t("Preparing image…"), 0), 300);
  try {
    blob = typeof source === "string" ? await prefetchImage(source) : source;
  } catch {
    toast(t("Couldn't download the image. Check your connection and try again."));
    return;
  } finally {
    clearTimeout(slow);
  }
  if (toastEl) toastEl.style.opacity = "0"; // hide "Preparing image…"
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
  toast(t("Saved “{name}” to your Downloads folder", { name }));
}
