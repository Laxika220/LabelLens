"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import type { Extraction } from "@/lib/ai/schemas";
import { blobToBase64, type ProcessedPhoto } from "@/lib/image/preprocess";
import { parseLabelText } from "@/lib/normalise/parse-label-text";
import { extractOnDevice } from "@/lib/ocr/tesseract";
import { saveDraft, type ExtractionSource } from "@/lib/storage/indexeddb";

const MAX_PHOTOS = 4;

type Shot = ProcessedPhoto & { id: string; url: string };

export default function ScanPage() {
  const router = useRouter();
  const [shots, setShots] = useState<Shot[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const addPhoto = useCallback((p: ProcessedPhoto) => {
    setError(null);
    setShots((prev) =>
      prev.length >= MAX_PHOTOS
        ? prev
        : [...prev, { ...p, id: crypto.randomUUID(), url: URL.createObjectURL(p.blob) }],
    );
  }, []);

  const removePhoto = (id: string) =>
    setShots((prev) => {
      const gone = prev.find((s) => s.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((s) => s.id !== id);
    });

  async function finish(extraction: Extraction, source: ExtractionSource, photos: Blob[]) {
    await saveDraft({ createdAt: Date.now(), photos, extraction, source, confirmed: false });
    router.push("/confirm");
  }

  async function readLabel() {
    const photos = shots.map((s) => s.blob);
    setError(null);
    setStatus("Reading label…");

    let fallbackReason: string | null = null;
    if (navigator.onLine) {
      try {
        const images = await Promise.all(
          photos.map(async (b) => ({ media_type: "image/jpeg" as const, data: await blobToBase64(b) })),
        );
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return finish(body.extraction, "claude", photos);
        if (res.status === 422 || res.status === 429) {
          setStatus(null);
          setError(body.message ?? "Couldn't read the label. Try a clearer photo.");
          return;
        }
        fallbackReason = body.message ?? "The label reader is unavailable.";
      } catch {
        fallbackReason = "Couldn't reach the label reader.";
      }
    } else {
      fallbackReason = "You're offline.";
    }

    try {
      setStatus(`${fallbackReason} Reading on your phone instead…`);
      const extraction = await extractOnDevice(photos, (p) =>
        setStatus(`${fallbackReason} Reading on your phone… ${Math.round(p * 100)}%`),
      );
      await finish(extraction, "on-device", photos);
    } catch {
      setStatus(null);
      setError("Couldn't read the label on this device. You can type the ingredients instead.");
    }
  }

  const reading = status !== null;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Scan the ingredients</h1>
        <p className="text-muted">
          If the list wraps around the pack, capture each part (up to {MAX_PHOTOS} photos).
        </p>
      </header>

      {!typing && <CameraCapture onPhoto={addPhoto} disabled={reading || shots.length >= MAX_PHOTOS} />}

      {shots.length > 0 && !typing && (
        <section aria-label="Captured photos" className="flex flex-col gap-3">
          <ul className="grid grid-cols-4 gap-2">
            {shots.map((s, i) => (
              <li key={s.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img
                  src={s.url}
                  alt={`Label part ${i + 1}`}
                  className="aspect-square w-full rounded-lg border border-border object-cover"
                />
                {(s.quality.blurry || s.quality.glare) && (
                  <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-amber-300 px-1 text-center text-[11px] font-semibold text-black">
                    {s.quality.glare ? "Glare?" : "Blurry?"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(s.id)}
                  disabled={reading}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute -top-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-lg leading-none"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary" onClick={readLabel} disabled={reading}>
            {reading
              ? "Reading…"
              : `Read label from ${shots.length} photo${shots.length > 1 ? "s" : ""}`}
          </button>
        </section>
      )}

      {status && (
        <p role="status" aria-live="polite" className="card text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-2xl border border-danger bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
      )}

      {typing ? (
        <section className="flex flex-col gap-3">
          <label htmlFor="typed" className="font-semibold">
            Type or paste the ingredient list
          </label>
          <textarea
            id="typed"
            rows={6}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Ingredients: wheat flour, sugar, palm oil, emulsifier (INS 322)…"
            className="rounded-xl border border-border bg-surface p-3 text-base"
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!typed.trim()}
            onClick={() => finish(parseLabelText(typed), "manual", [])}
          >
            Continue
          </button>
          <button type="button" className="btn-secondary" onClick={() => setTyping(false)}>
            Back to camera
          </button>
        </section>
      ) : (
        <button type="button" className="text-left text-sm font-semibold text-accent underline" onClick={() => setTyping(true)}>
          Can&apos;t photograph it? Type the ingredients instead
        </button>
      )}
    </div>
  );
}
