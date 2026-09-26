// iPhone photos are often HEIC. Safari can decode them, but Chrome and Firefox
// can't, so there every <img>, canvas and face detector failed on them and the
// upload silently did nothing. Such a file is converted to JPEG in the browser
// first. The converter (libheif, ~2.7 MB) is only loaded when one shows up.
// The JPEG carries no EXIF, so read GPS/date from the ORIGINAL file.

function looksLikeHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

async function browserCanDecode(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/** The file itself, or a JPEG copy when it's a HEIC this browser can't show. */
export async function toDisplayableImage(file: File): Promise<File> {
  if (!looksLikeHeic(file) || (await browserCanDecode(file))) return file;
  const { heicTo } = await import("heic-to/next");
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
  return new File([jpeg], file.name.replace(/\.(heic|heif)$/i, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}
