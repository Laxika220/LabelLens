"use client";

import { newId } from "@/lib/id";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { blobToBase64, type ProcessedPhoto } from "@/lib/image/preprocess";
import { parseLabelText } from "@/lib/normalise/parse-label-text";
import { extractOnDevice } from "@/lib/ocr/tesseract";
import { fromExtraction } from "@/lib/read/from-extraction";
import { AssessSchema, ReadResultSchema, type Assessment, type ReadResult, type ReadSource } from "@/lib/read/types";
import { loadDraft, saveDraft } from "@/lib/storage/indexeddb";

const MAX_PHOTOS = 4;

type Shot = {
  id: string;
  blob: Blob;
  url: string;
  localHint: string | null; // instant on-phone check
  assess: Assessment | null; // server check, per text region
  assessState: "pending" | "done" | "unavailable";
};

const VERDICT_LABEL: Record<Assessment["verdict"], string> = {
  good: "Clear",
  usable: "Partly clear",
  retake: "Retake suggested",
};

async function assess(blob: Blob): Promise<Assessment | null> {
  const form = new FormData();
  form.append("image", blob, "photo.jpg");
  try {
    const res = await fetch("/api/assess", { method: "POST", body: form });
    const parsed = AssessSchema.safeParse(await res.json().catch(() => null));
    return res.ok && parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export default function ScanPage() {
  const router = useRouter();
  const [shots, setShots] = useState<Shot[]>([]);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const makeShot = useCallback((blob: Blob, localHint: string | null): Shot => {
    const shot: Shot = { id: newId(), blob, url: URL.createObjectURL(blob), localHint, assess: null, assessState: "pending" };
    assess(blob).then((a) =>
      setShots((prev) => prev.map((s) => (s.id === shot.id ? { ...s, assess: a, assessState: a ? "done" : "unavailable" } : s))),
    );
    return shot;
  }, []);

  // "Retake photo N" from the review screen: reload the other photos and
  // replace only that one.
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("retake"));
    if (!n) return;
    loadDraft().then((d) => {
      if (!d?.photos.length) return;
      setShots(d.photos.map((b) => makeShot(b, null)));
      setReplaceIndex(n - 1);
    });
  }, [makeShot]);

  const addPhoto = useCallback(
    (p: ProcessedPhoto) => {
      setError(null);
      let hint: string | null = null;
      if (p.quality.glare) hint = "Glare?";
      else if (p.quality.blurry) hint = "Blurry?";
      const current = shotsRef.current;
      if (replaceIndex === null && current.length >= MAX_PHOTOS) return;
      const shot = makeShot(p.blob, hint);
      setShots((prev) => {
        if (replaceIndex !== null && replaceIndex < prev.length) {
          URL.revokeObjectURL(prev[replaceIndex].url);
          const next = [...prev];
          next[replaceIndex] = shot;
          return next;
        }
        return [...prev, shot];
      });
      setReplaceIndex(null);
    },
    [makeShot, replaceIndex],
  );

  const removePhoto = (id: string) =>
    setShots((prev) => {
      const gone = prev.find((s) => s.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((s) => s.id !== id);
    });

  async function finish(result: ReadResult, source: ReadSource, photos: Blob[]) {
    await saveDraft({ createdAt: Date.now(), photos, result, source, confirmed: false });
    router.push("/confirm");
  }

  async function readLabel() {
    const photos = shots.map((s) => s.blob);
    setError(null);
    setStatus("Reading the label: checking each word against several readings…");

    let reason: string;
    if (!navigator.onLine) {
      reason = "You're offline.";
    } else {
      // 1. Full pipeline (OCR on several versions of the photo + independent AI check).
      try {
        const form = new FormData();
        photos.forEach((b, i) => form.append("images", b, `photo-${i + 1}.jpg`));
        const res = await fetch("/api/read", { method: "POST", body: form });
        const body = await res.json().catch(() => null);
        if (res.ok) {
          const parsed = ReadResultSchema.safeParse(body);
          if (parsed.success) return finish(parsed.data, "pipeline", photos);
        }
        if (res.status === 422 || res.status === 429 || res.status === 400) {
          setStatus(null);
          setError(body?.message ?? "Couldn't read the label. Try a clearer photo.");
          return;
        }
        reason = "The main label reader is unavailable.";
      } catch {
        reason = "Couldn't reach the label reader.";
      }

      // 2. AI alone (no cross-check: everything will need checking).
      try {
        setStatus(`${reason} Trying the AI reader on its own…`);
        const images = await Promise.all(photos.map(async (b) => ({ media_type: "image/jpeg" as const, data: await blobToBase64(b) })));
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images }),
        });
        const body = await res.json().catch(() => null);
        if (res.ok) return finish(fromExtraction(body.extraction, "claude"), "claude-only", photos);
        reason = body?.message ?? reason;
      } catch {
        /* fall through to on-device */
      }
    }

    // 3. On-device OCR.
    try {
      setStatus(`${reason} Reading on your phone instead…`);
      const extraction = await extractOnDevice(photos, (p) =>
        setStatus(`${reason} Reading on your phone… ${Math.round(p * 100)}%`),
      );
      await finish(fromExtraction(extraction, "tesseract"), "on-device", photos);
    } catch {
      setStatus(null);
      setError("Couldn't read the label on this device. You can type the ingredients instead.");
    }
  }

  const reading = status !== null;
  const full = shots.length >= MAX_PHOTOS && replaceIndex === null;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Scan the ingredients</h1>
        <p className="text-muted">
          {replaceIndex !== null
            ? `Retaking photo ${replaceIndex + 1}. Capture that part of the label again.`
            : `Hold the phone flat, close enough that the text fills the box. If the list wraps around the pack, capture each part with a little overlap (up to ${MAX_PHOTOS} photos).`}
        </p>
      </header>

      {!typing && <CameraCapture onPhoto={addPhoto} disabled={reading || full} />}

      {shots.length > 0 && !typing && (
        <section aria-label="Captured photos" className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {shots.map((s, i) => (
              <li key={s.id} className="card flex gap-3 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img src={s.url} alt={`Label part ${i + 1}`} className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">
                    Photo {i + 1}
                    {s.assessState === "pending" && <span className="ml-2 font-normal text-muted">checking quality…</span>}
                    {s.assess && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
                          s.assess.verdict === "good" ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn"
                        }`}
                      >
                        {VERDICT_LABEL[s.assess.verdict]}
                      </span>
                    )}
                  </p>
                  {s.assess?.advice.slice(0, 2).map((tip) => (
                    <p key={tip} className="mt-1 text-muted">{tip}</p>
                  ))}
                  {s.assessState === "unavailable" && s.localHint && <p className="mt-1 text-muted">{s.localHint} You may want to retake it.</p>}
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="min-h-11 rounded-lg border border-border px-3 font-semibold" disabled={reading} onClick={() => setReplaceIndex(i)}>
                      Retake
                    </button>
                    <button type="button" className="min-h-11 rounded-lg border border-border px-3" disabled={reading} onClick={() => removePhoto(s.id)} aria-label={`Remove photo ${i + 1}`}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {replaceIndex !== null && (
            <p className="rounded-xl border border-warn-border bg-warn-soft p-3 text-sm">
              Next capture replaces photo {replaceIndex + 1}.{" "}
              <button type="button" className="font-semibold underline" onClick={() => setReplaceIndex(null)}>Cancel</button>
            </p>
          )}
          <button type="button" className="btn-primary" onClick={readLabel} disabled={reading || replaceIndex !== null}>
            {reading ? "Reading…" : `Read label from ${shots.length} photo${shots.length > 1 ? "s" : ""}`}
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
            onClick={() => finish(fromExtraction(parseLabelText(typed), "typed"), "manual", [])}
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
