import type { Status } from "@/lib/read/types";

export type ReviewStatus = Status | "edited";

export const STATUS_INFO: Record<ReviewStatus, { label: string; meaning: string; className: string }> = {
  confirmed: {
    label: "Confirmed",
    meaning: "Read clearly. Several readings agree and every word is a known word or code.",
    className: "border-accent/40 bg-accent-soft text-accent",
  },
  probable: {
    label: "Check",
    meaning: "Probably right, but not fully verified (e.g. only one reader, or an unknown word).",
    className: "border-warn-border bg-warn-soft text-warn",
  },
  conflicting: {
    label: "Readings differ",
    meaning: "Different readings of the photo disagree. Pick the one that matches the label.",
    className: "border-warn-border bg-warn-soft text-warn",
  },
  unreadable: {
    label: "Unreadable",
    meaning: "Not enough detail in the photo to read this. Type what the label says, or retake.",
    className: "border-danger bg-danger-soft text-danger",
  },
  missing: {
    label: "Missing",
    meaning: "This part of the label isn't in the photos. Capture it, or check it on the pack.",
    className: "border-danger bg-danger-soft text-danger",
  },
  edited: {
    label: "Checked by you",
    meaning: "You edited, chose or typed this, so your version is used.",
    className: "border-border bg-surface-2 text-fg",
  },
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  const info = STATUS_INFO[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-bold ${info.className}`}>
      {info.label}
    </span>
  );
}

export function StatusLegend() {
  return (
    <details className="card text-sm">
      <summary className="cursor-pointer font-semibold">What the labels mean</summary>
      <dl className="mt-2 flex flex-col gap-2">
        {(Object.keys(STATUS_INFO) as ReviewStatus[]).map((s) => (
          <div key={s} className="flex gap-2">
            <dt><StatusBadge status={s} /></dt>
            <dd className="text-muted">{STATUS_INFO[s].meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
