import "server-only";

// Server-side client for the Python vision service. The token never reaches
// the browser.

export function visionServiceUrl() {
  return process.env.VISION_SERVICE_URL?.replace(/\/$/, "") || null;
}

export async function callVisionService(path: string, form: FormData, timeoutMs: number) {
  const url = visionServiceUrl();
  if (!url) return null;
  return fetch(`${url}${path}`, {
    method: "POST",
    body: form,
    headers: { "x-service-token": process.env.VISION_SERVICE_TOKEN ?? "" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Validate the photos in a browser upload; returns an error message or null.
export function checkPhotos(files: File[]): string | null {
  if (files.length < 1 || files.length > 4) return "Send 1 to 4 photos.";
  for (const f of files) {
    if (!PHOTO_TYPES.has(f.type)) return "Photos must be JPEG, PNG or WebP.";
    if (f.size > MAX_PHOTO_BYTES) return "Each photo must be under 3 MB.";
  }
  return null;
}
