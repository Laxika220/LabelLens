"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GUIDE_FRAME,
  fileToCanvas,
  grabFrame,
  measureVideoQuality,
  processCanvas,
  type ProcessedPhoto,
} from "@/lib/image/preprocess";

type CameraState = "starting" | "live" | "unavailable";

// Extra constraints not yet in TypeScript's DOM lib.
type ExtendedCapabilities = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };

const HINTS = {
  frame: "Fit the ingredients list inside the box",
  blurry: "Too blurry — hold steady",
  glare: "Glare detected — tilt slightly",
  good: "Looks clear — tap the button",
} as const;

export function CameraCapture({
  onPhoto,
  disabled,
}: {
  onPhoto: (photo: ProcessedPhoto) => void;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [hint, setHint] = useState<keyof typeof HINTS>("frame");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  const track = () => streamRef.current?.getVideoTracks()[0];

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unavailable");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const caps = (stream.getVideoTracks()[0].getCapabilities?.() ?? {}) as ExtendedCapabilities;
        setTorchSupported(Boolean(caps.torch));
        setState("live");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Live quality hints, sampled twice a second.
  useEffect(() => {
    if (state !== "live") return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const q = measureVideoQuality(video);
      if (!q) return;
      setHint(q.glare ? "glare" : q.blurry ? "blurry" : "good");
    }, 500);
    return () => window.clearInterval(id);
  }, [state]);

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await track()?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const tapToFocus = async (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setFocusPoint({ x, y });
    window.setTimeout(() => setFocusPoint(null), 800);
    const caps = (track()?.getCapabilities?.() ?? {}) as ExtendedCapabilities;
    if (!caps.focusMode?.includes("single-shot")) return;
    try {
      await track()?.applyConstraints({
        advanced: [{ focusMode: "single-shot", pointsOfInterest: [{ x, y }] } as MediaTrackConstraintSet],
      });
    } catch {
      // Focus control is best-effort; many browsers don't support it.
    }
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    try {
      onPhoto(await processCanvas(grabFrame(video)));
    } finally {
      setBusy(false);
    }
  }, [onPhoto]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        onPhoto(await processCanvas(await fileToCanvas(file)));
      }
    } finally {
      setBusy(false);
    }
  };

  const fileButtons = (
    <div className="grid grid-cols-2 gap-3">
      <label className="btn-secondary cursor-pointer">
        Take photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <label className="btn-secondary cursor-pointer">
        From gallery
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );

  if (state === "unavailable") {
    return (
      <div className="flex flex-col gap-3">
        <div className="card text-sm text-muted">
          The live camera isn&apos;t available here (it needs HTTPS and camera permission). You can
          still take a photo with your camera app or pick one from your gallery.
        </div>
        {fileButtons}
      </div>
    );
  }

  const r = GUIDE_FRAME;
  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative aspect-[3/4] w-full touch-manipulation overflow-hidden rounded-2xl bg-black"
        onPointerDown={tapToFocus}
      >
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
          aria-label="Camera preview"
        />
        {/* Guide frame; the giant shadow dims everything outside it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        />
        {focusPoint && (
          <div
            aria-hidden
            className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300"
            style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }}
          />
        )}
        <p
          role="status"
          aria-live="polite"
          className={`absolute inset-x-4 top-3 rounded-full px-4 py-2 text-center text-sm font-semibold ${
            hint === "blurry" || hint === "glare" ? "bg-amber-300 text-black" : "bg-black/60 text-white"
          }`}
        >
          {state === "starting" ? "Starting camera…" : HINTS[hint]}
        </p>
        {torchSupported && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={toggleTorch}
            aria-pressed={torchOn}
            className="absolute right-3 bottom-3 min-h-12 rounded-full bg-black/60 px-4 text-sm font-semibold text-white"
          >
            {torchOn ? "Light on" : "Light off"}
          </button>
        )}
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={disabled || busy || state !== "live"}
        onClick={capture}
      >
        {busy ? "Processing…" : "Capture this part of the label"}
      </button>
      {fileButtons}
    </div>
  );
}
