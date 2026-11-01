"use client";

// Client-side image pipeline. Re-encoding through a canvas drops all EXIF/GPS
// metadata, so nothing location-related ever leaves the device.

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

// Tuned on a 240px-wide luminance sample; adjust with real-device testing.
export const BLUR_THRESHOLD = 45;
export const GLARE_FRACTION = 0.03;

export type Quality = { blurry: boolean; glare: boolean; sharpness: number; glareFraction: number };

// Guide frame as a fraction of the visible camera preview.
export type FrameRect = { x: number; y: number; w: number; h: number };
export const GUIDE_FRAME: FrameRect = { x: 0.07, y: 0.18, w: 0.86, h: 0.56 };

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Map a rect expressed relative to an object-fit: cover <video> element to
// the matching rect in the camera's native pixels.
function coverToSource(video: HTMLVideoElement, r: FrameRect) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const scale = Math.max(ew / vw, eh / vh);
  const offX = (vw * scale - ew) / 2;
  const offY = (vh * scale - eh) / 2;
  return {
    sx: (r.x * ew + offX) / scale,
    sy: (r.y * eh + offY) / scale,
    sw: (r.w * ew) / scale,
    sh: (r.h * eh) / scale,
  };
}

export function grabFrame(video: HTMLVideoElement, frame: FrameRect = GUIDE_FRAME): HTMLCanvasElement {
  const { sx, sy, sw, sh } = coverToSource(video, frame);
  const c = canvas(sw, sh);
  c.getContext("2d")!.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const c = canvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

function luminance(data: Uint8ClampedArray, n: number) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return y;
}

// Variance of the Laplacian (sharpness) and share of blown-out pixels (glare)
// on a small downscaled copy, cheap enough to run on live preview frames.
export function measureQuality(source: CanvasImageSource, sw: number, sh: number, frame?: FrameRect): Quality {
  const W = 240;
  const r = frame ?? { x: 0, y: 0, w: 1, h: 1 };
  const cw = sw * r.w;
  const ch = sh * r.h;
  const H = Math.max(1, Math.round((W * ch) / cw));
  const c = canvas(W, H);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, sw * r.x, sh * r.y, cw, ch, 0, 0, W, H);
  const y = luminance(ctx.getImageData(0, 0, W, H).data, W * H);

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let bright = 0;
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i;
      const lap = y[k - 1] + y[k + 1] + y[k - W] + y[k + W] - 4 * y[k];
      sum += lap;
      sumSq += lap * lap;
      count++;
      if (y[k] > 250) bright++;
    }
  }
  const mean = sum / count;
  const sharpness = sumSq / count - mean * mean;
  const glareFraction = bright / count;
  return {
    sharpness,
    glareFraction,
    blurry: sharpness < BLUR_THRESHOLD,
    glare: glareFraction > GLARE_FRACTION,
  };
}

export function measureVideoQuality(video: HTMLVideoElement, frame: FrameRect = GUIDE_FRAME): Quality | null {
  if (!video.videoWidth) return null;
  const { sx, sy, sw, sh } = coverToSource(video, frame);
  return measureQuality(video, video.videoWidth, video.videoHeight, {
    x: sx / video.videoWidth,
    y: sy / video.videoHeight,
    w: sw / video.videoWidth,
    h: sh / video.videoHeight,
  });
}

// Percentile contrast stretch + light unsharp mask, applied in place.
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const y = luminance(d, n);

  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[y[i] | 0]++;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
  const range = hi - lo;
  const gain = range > 40 ? 255 / range : 1;
  const shift = range > 40 ? lo : 0;

  const src = new Uint8ClampedArray(d);
  const amount = 0.5;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let v = (src[k + ch] - shift) * gain;
        if (i > 0 && j > 0 && i < w - 1 && j < h - 1) {
          const blur =
            (src[k + ch - 4] + src[k + ch + 4] + src[k + ch - w * 4] + src[k + ch + w * 4]) / 4;
          v += amount * ((src[k + ch] - blur) * gain);
        }
        d[k + ch] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

export type ProcessedPhoto = { blob: Blob; width: number; height: number; quality: Quality };

export async function processCanvas(src: HTMLCanvasElement): Promise<ProcessedPhoto> {
  const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const out = canvas(src.width * scale, src.height * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  const quality = measureQuality(out, out.width, out.height);
  enhance(ctx, out.width, out.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", JPEG_QUALITY),
  );
  return { blob, width: out.width, height: out.height, quality };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
