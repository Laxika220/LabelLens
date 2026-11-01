"use client";

import type { Extraction } from "@/lib/ai/schemas";
import { parseLabelText } from "@/lib/normalise/parse-label-text";

// On-device OCR fallback. Loaded lazily: the worker and language data are a
// few MB and are only needed when the server reader is unavailable.
export async function extractOnDevice(
  photos: Blob[],
  onProgress?: (fraction: number) => void,
): Promise<Extraction> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, {
    logger: (m) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    const texts: string[] = [];
    for (const photo of photos) {
      const { data } = await worker.recognize(photo);
      texts.push(data.text);
    }
    const extraction = parseLabelText(texts.join(", "), { fromOcr: true });
    extraction.unreadable_regions = extraction.ingredients.some((i) => i.confidence < 0.5);
    return extraction;
  } finally {
    await worker.terminate();
  }
}
