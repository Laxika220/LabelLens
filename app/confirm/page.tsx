"use client";

import { newId } from "@/lib/id";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PhotoHighlight } from "@/components/PhotoHighlight";
import { SafetyPanel } from "@/components/SafetyPanel";
import { StatusBadge, StatusLegend, type ReviewStatus } from "@/components/StatusBadge";
import type { Item, ReadSource } from "@/lib/read/types";
import { loadDraft, saveDraft, type ReviewedItem, type ScanDraft } from "@/lib/storage/indexeddb";

type Row = {
  id: string;
  kind: Item["kind"];
  item: Item;
  words: string[]; // current words; empty once the user free-edits
  text: string;
  status: ReviewStatus;
  acknowledged: boolean; // for missing / unreadable regions
};

const SOURCE_LABEL: Record<ReadSource, string> = {
  pipeline: "Read from your photos by OCR on several versions of each photo, cross-checked word by word",
  "claude-only": "Read by AI only (the main reader was unavailable), so nothing is cross-checked",
  "on-device": "Read on your phone without AI, so nothing is cross-checked",
  manual: "Typed by you",
};

function toRows(items: Item[]): Row[] {
  return items.map((item) => ({
    id: newId(),
    kind: item.kind,
    item,
    words: item.words.map((w) => w.text),
    text: item.raw,
    status: item.status,
    acknowledged: false,
  }));
}

function needsAction(r: Row) {
  if (r.kind === "missing" || r.kind === "unreadable_region") return !r.acknowledged;
  return r.status === "conflicting" || r.status === "unreadable";
}

function sourceSummary(item: Item): string | null {
  if (!item.words.length) return null;
  const ocr = new Set(item.words.flatMap((w) => w.support.filter((s) => s.includes("rapidocr")).map((s) => s.split(":").pop())));
  const claudeChecked = item.engines_agree !== null;
  const parts = [`OCR: ${ocr.size} version${ocr.size === 1 ? "" : "s"} of the photo agree`];
  if (claudeChecked) parts.push(item.engines_agree ? "AI check: agrees" : "AI check: read it differently");
  return parts.join(" · ");
}

function RowEditor({
  row,
  photoUrl,
  photoSize,
  onChange,
  onRemove,
  onRetake,
}: {
  row: Row;
  photoUrl: string | null;
  photoSize: { width: number; height: number } | null;
  onChange: (r: Row) => void;
  onRemove: () => void;
  onRetake: (photo: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [showPhoto, setShowPhoto] = useState(false);
  const isGap = row.kind === "missing" || row.kind === "unreadable_region";

  const replaceWord = (i: number, value: string) => {
    const words = [...row.words];
    if (value.startsWith("+")) words.splice(i + 1, 0, value.slice(1));
    else words[i] = value;
    onChange({ ...row, words, text: words.join(" ").replace(/[,;.]+$/, ""), status: "edited" });
  };

  const save = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== row.text) onChange({ ...row, words: [], text: t, status: "edited" });
  };

  // Word-level choices, only while the words still line up with the reading.
  const wordChoices =
    row.status !== "edited" && row.words.length === row.item.words.length
      ? row.item.words
          .map((w, i) => ({ w, i }))
          .filter(({ w }) => Object.keys(w.alternatives).length > 0 || w.suggestions.length > 0 || w.status === "unreadable")
      : [];

  return (
    <li className={`card flex flex-col gap-2 ${needsAction(row) ? "border-2 border-warn-border" : ""}`}>
      <div className="flex items-start gap-2">
        <StatusBadge status={row.status} />
        {isGap ? (
          <p className="flex-1 text-sm">{row.item.note}</p>
        ) : editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && save()}
            aria-label={`Edit ${row.text}`}
            className="min-h-11 flex-1 rounded-lg border-2 border-accent bg-surface px-3 text-base"
          />
        ) : (
          <button
            type="button"
            className="min-h-11 flex-1 text-left text-base font-semibold"
            onClick={() => {
              setDraft(row.text);
              setEditing(true);
            }}
            aria-label={`${row.text}. Tap to edit`}
          >
            {row.text || <span className="text-muted italic">(nothing read)</span>}
          </button>
        )}
        {!isGap && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${row.text}`} className="min-h-11 min-w-11 text-xl text-muted">
            ×
          </button>
        )}
      </div>

      {wordChoices.map(({ w, i }) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {w.status === "unreadable" ? `"${w.text}" is hard to read.` : `"${w.text}":`}
          </span>
          {Object.entries(w.alternatives).map(([alt, srcs]) => (
            <button
              key={alt}
              type="button"
              className="min-h-11 rounded-lg border border-border bg-surface-2 px-3"
              onClick={() => replaceWord(i, alt)}
              title={`Read this way by: ${srcs.join(", ")}`}
            >
              {alt.startsWith("+") ? `add "${alt.slice(1)}"` : `use "${alt}"`}
              <span className="ml-1 text-xs text-muted">({srcs.some((s) => s === "claude") ? "AI reading" : "other photo version"})</span>
            </button>
          ))}
          {w.suggestions.map((sug) => (
            <button key={sug} type="button" className="min-h-11 rounded-lg border border-border px-3" onClick={() => replaceWord(i, sug)}>
              Did you mean &ldquo;{sug}&rdquo;?
            </button>
          ))}
          <button type="button" className="min-h-11 rounded-lg px-2 underline" onClick={() => onChange({ ...row, status: "edited" })}>
            &ldquo;{w.text}&rdquo; is right
          </button>
        </div>
      ))}

      {!isGap && row.status !== "edited" && sourceSummary(row.item) && (
        <p className="text-xs text-muted">{sourceSummary(row.item)}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {row.item.boxes.length > 0 && photoUrl && photoSize && (
          <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm" onClick={() => setShowPhoto((v) => !v)} aria-expanded={showPhoto}>
            {showPhoto ? "Hide photo" : "Show on photo"}
          </button>
        )}
        {isGap && row.item.photo !== null && (
          <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold" onClick={() => onRetake(row.item.photo!)}>
            Retake photo {row.item.photo + 1}
          </button>
        )}
        {isGap && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={row.acknowledged}
              onChange={(e) => onChange({ ...row, acknowledged: e.target.checked })}
            />
            I&apos;ve checked this part on the pack
          </label>
        )}
      </div>
      {showPhoto && photoUrl && photoSize && (
        <PhotoHighlight url={photoUrl} width={photoSize.width} height={photoSize.height} boxes={row.item.boxes} label={`Where "${row.text}" was read`} />
      )}
    </li>
  );
}

export default function ConfirmPage() {
  const [draft, setDraft] = useState<ScanDraft | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    loadDraft().then((d) => {
      setDraft(d ?? null);
      if (!d) return;
      setRows(toRows(d.result.items));
      setPhotoUrls(d.photos.map((p) => URL.createObjectURL(p)));
    });
  }, []);
  useEffect(() => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)), [photoUrls]);

  const update = (id: string, r: Row) => {
    setSaved(false);
    setRows((prev) => prev.map((x) => (x.id === id ? r : x)));
  };
  const remove = (id: string) => {
    setSaved(false);
    setRows((prev) => prev.filter((x) => x.id !== id));
  };
  const retake = (photo: number) => {
    window.location.href = `/scan?retake=${photo + 1}`;
  };

  const gaps = rows.filter((r) => r.kind === "missing" || r.kind === "unreadable_region");
  const ingredients = rows.filter((r) => r.kind === "ingredient");
  const statements = rows.filter((r) => r.kind === "statement");
  const blocking = rows.filter(needsAction).length;
  const toCheck = rows.filter((r) => r.status === "probable").length;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (r.kind === "ingredient" || r.kind === "statement") c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  async function confirm() {
    if (!draft || blocking) return;
    const reviewed: ReviewedItem[] = rows
      .filter((r): r is Row & { kind: "ingredient" | "statement" } => r.kind === "ingredient" || r.kind === "statement")
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.text,
        read_as: r.item.raw,
        status_when_read: r.item.status,
        checked_by_user: r.status === "edited",
      }));
    await saveDraft({ ...draft, confirmed: true, reviewed });
    setSaved(true);
  }

  if (draft === undefined) return <p className="pt-6 text-muted">Loading…</p>;
  if (draft === null) {
    return (
      <div className="flex flex-col gap-4 pt-6">
        <p>There&apos;s no scan to check yet.</p>
        <Link href="/scan" className="btn-primary">Scan a label</Link>
      </div>
    );
  }

  const { result } = draft;
  const editorFor = (r: Row) => {
    const p = r.item.photo;
    const photo = p !== null ? result.photos.find((x) => x.index === p) : undefined;
    return (
      <RowEditor
        key={r.id}
        row={r}
        photoUrl={p !== null ? photoUrls[p] ?? null : null}
        photoSize={photo ? { width: photo.width, height: photo.height } : null}
        onChange={(n) => update(r.id, n)}
        onRemove={() => remove(r.id)}
        onRetake={retake}
      />
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">Check what was read</h1>
        <p className="text-muted">Compare each line with the label. Nothing is analysed until you confirm.</p>
        <p className="mt-1 text-xs text-muted">{SOURCE_LABEL[draft.source]}.</p>
      </header>

      {result.allergen_section_uncertain && (
        <div role="alert" className="rounded-2xl border-2 border-danger bg-danger-soft p-4 text-danger">
          <p className="font-bold">Allergen information may be incomplete</p>
          <p className="mt-1 text-sm">
            Part of this label couldn&apos;t be read reliably. Don&apos;t rely on this app to rule out an allergen. Check the
            physical label.
          </p>
        </div>
      )}
      {result.warnings
        .filter((w) => !w.includes("allergens may be missed"))
        .map((w) => (
          <p key={w} className="rounded-xl border border-warn-border bg-warn-soft p-3 text-sm">{w}</p>
        ))}

      <p className="text-sm">
        {Object.entries(counts).map(([s, n]) => (
          <span key={s} className="mr-3 inline-flex items-center gap-1">
            <StatusBadge status={s as ReviewStatus} /> {n}
          </span>
        ))}
      </p>
      <StatusLegend />

      {gaps.length > 0 && (
        <section aria-labelledby="gaps-h" className="flex flex-col gap-2">
          <h2 id="gaps-h" className="font-bold">Parts that couldn&apos;t be read</h2>
          <ul className="flex flex-col gap-2">{gaps.map(editorFor)}</ul>
        </section>
      )}

      <section aria-labelledby="ing-h" className="flex flex-col gap-2">
        <h2 id="ing-h" className="font-bold">
          Ingredients <span className="font-normal text-muted">({ingredients.length}, in label order)</span>
        </h2>
        <ul className="flex flex-col gap-2">{ingredients.map(editorFor)}</ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = adding.trim();
            if (!t) return;
            const item: Item = { kind: "ingredient", raw: t, status: "confirmed", words: [], photo: null, boxes: [], sources: ["you"], engines_agree: null, needs_review: false, note: "" };
            setRows((prev) => [...prev, { id: newId(), kind: "ingredient", item, words: [], text: t, status: "edited", acknowledged: false }]);
            setAdding("");
            setSaved(false);
          }}
        >
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Add a missed ingredient"
            aria-label="Add a missed ingredient"
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-base"
          />
          <button type="submit" className="btn-secondary px-4" disabled={!adding.trim()}>Add</button>
        </form>
      </section>

      <section aria-labelledby="alg-h" className="flex flex-col gap-2">
        <h2 id="alg-h" className="font-bold">Allergen statements</h2>
        {statements.length ? (
          <ul className="flex flex-col gap-2">{statements.map(editorFor)}</ul>
        ) : (
          <p className="text-sm text-muted">None read. That doesn&apos;t mean the label has none.</p>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        {blocking > 0 ? (
          <p className="text-sm font-semibold text-warn">
            {blocking} item{blocking > 1 ? "s" : ""} still need{blocking > 1 ? "" : "s"} your decision (outlined above).
          </p>
        ) : toCheck > 0 ? (
          <p className="text-sm text-muted">{toCheck} item{toCheck > 1 ? "s are" : " is"} marked &ldquo;Check&rdquo;. Make sure they match the label.</p>
        ) : null}
        <button type="button" className="btn-primary" onClick={confirm} disabled={blocking > 0 || ingredients.length === 0}>
          {saved ? "Saved ✓" : "This matches the label"}
        </button>
        <Link href="/scan" className="btn-secondary">Start again</Link>
      </div>

      {saved && (
        <>
          <section className="card text-sm" aria-live="polite">
            <p className="font-semibold">Ingredient list confirmed.</p>
            <p className="mt-1 text-muted">Research-backed ingredient information comes in a later milestone.</p>
          </section>
          <SafetyPanel
            lines={rows
              .filter((r) => r.kind === "ingredient" || r.kind === "statement")
              .map((r) => ({ kind: r.kind as "ingredient" | "statement", text: r.text }))}
            readIncomplete={result.allergen_section_uncertain || draft.source !== "pipeline" && draft.source !== "manual"}
          />
        </>
      )}
    </div>
  );
}
