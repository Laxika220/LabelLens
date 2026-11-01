"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { IngredientChips, LOW_CONFIDENCE, type ChipItem } from "@/components/IngredientChips";
import type { ExtractedIngredient, ExtractedSubIngredient, Extraction } from "@/lib/ai/schemas";
import { parseIngredient } from "@/lib/normalise/parse-label-text";
import { loadDraft, saveDraft, type ScanDraft } from "@/lib/storage/indexeddb";

type Sub = ExtractedSubIngredient & { id: string };
type Item = Omit<ExtractedIngredient, "sub_ingredients"> & { id: string; sub_ingredients: Sub[] };

const withIds = (e: Extraction): Item[] =>
  e.ingredients.map((i) => ({
    ...i,
    id: crypto.randomUUID(),
    sub_ingredients: i.sub_ingredients.map((s) => ({ ...s, id: crypto.randomUUID() })),
  }));

const stripIds = (items: Item[]): ExtractedIngredient[] =>
  items.map(({ id: _id, sub_ingredients, ...rest }) => ({
    ...rest,
    sub_ingredients: sub_ingredients.map(({ id: _sid, ...s }) => s),
  }));

const SOURCE_LABEL: Record<ScanDraft["source"], string> = {
  claude: "Read by AI from your photo",
  "on-device": "Read on your phone without AI",
  manual: "Typed by you",
};

export default function ConfirmPage() {
  const [draft, setDraft] = useState<ScanDraft | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [statements, setStatements] = useState<{ id: string; text: string }[]>([]);
  const [productName, setProductName] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadDraft().then((d) => {
      setDraft(d ?? null);
      if (!d) return;
      setItems(withIds(d.extraction));
      setStatements(d.extraction.allergen_statements.map((text) => ({ id: crypto.randomUUID(), text })));
      setProductName(d.extraction.product_name_guess ?? "");
      setPhotoUrls(d.photos.map((p) => URL.createObjectURL(p)));
    });
  }, []);
  useEffect(() => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)), [photoUrls]);

  const chips: ChipItem[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        label: i.raw,
        lowConfidence: i.confidence < LOW_CONFIDENCE,
        children: i.sub_ingredients.map((s) => ({
          id: s.id,
          label: s.raw,
          lowConfidence: s.confidence < LOW_CONFIDENCE,
        })),
      })),
    [items],
  );
  const lowCount = chips.reduce(
    (n, c) => n + (c.lowConfidence ? 1 : 0) + (c.children?.filter((s) => s.lowConfidence).length ?? 0),
    0,
  );

  const edit = (id: string, label: string) => {
    setSaved(false);
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          const p = parseIngredient(label);
          // Keep existing sub-ingredients if the edited text no longer lists them.
          const subs = p.sub_ingredients.length
            ? p.sub_ingredients.map((s) => ({ ...s, id: crypto.randomUUID() }))
            : i.sub_ingredients;
          return { ...p, id, sub_ingredients: subs };
        }
        const subIdx = i.sub_ingredients.findIndex((s) => s.id === id);
        if (subIdx === -1) return i;
        const { sub_ingredients: _ignored, ...p } = parseIngredient(label);
        const subs = [...i.sub_ingredients];
        subs[subIdx] = { ...p, id };
        return { ...i, sub_ingredients: subs };
      }),
    );
  };

  const remove = (id: string) => {
    setSaved(false);
    setItems((prev) =>
      prev
        .filter((i) => i.id !== id)
        .map((i) => ({ ...i, sub_ingredients: i.sub_ingredients.filter((s) => s.id !== id) })),
    );
  };

  const add = (label: string) => {
    setSaved(false);
    const p = parseIngredient(label);
    setItems((prev) => [
      ...prev,
      { ...p, id: crypto.randomUUID(), sub_ingredients: p.sub_ingredients.map((s) => ({ ...s, id: crypto.randomUUID() })) },
    ]);
  };

  async function confirm() {
    if (!draft) return;
    const extraction: Extraction = {
      ...draft.extraction,
      product_name_guess: productName.trim() || null,
      ingredients: stripIds(items),
      allergen_statements: statements.map((s) => s.text),
    };
    await saveDraft({ ...draft, extraction, confirmed: true });
    setDraft({ ...draft, extraction, confirmed: true });
    setSaved(true);
  }

  if (draft === undefined) return <p className="pt-6 text-muted">Loading…</p>;
  if (draft === null) {
    return (
      <div className="flex flex-col gap-4 pt-6">
        <p>There&apos;s no scan to check yet.</p>
        <Link href="/scan" className="btn-primary">
          Scan a label
        </Link>
      </div>
    );
  }

  const { extraction, source } = draft;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold">Check the ingredients</h1>
        <p className="text-muted">
          Compare this list with the label. Tap an item to fix it, × to remove it, or add anything
          that was missed.
        </p>
      </header>

      {photoUrls.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto" aria-label="Your label photos">
          {photoUrls.map((u, i) => (
            <li key={u} className="shrink-0">
              <button type="button" onClick={() => setZoom(u)} aria-label={`Enlarge label part ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img src={u} alt="" className="h-24 w-auto rounded-lg border border-border" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted">{SOURCE_LABEL[source]}</p>
        {(extraction.unreadable_regions || source === "on-device") && (
          <p className="rounded-xl border border-warn-border bg-warn-soft p-3 text-fg">
            {extraction.unreadable_regions
              ? "Part of the list may be cut off or hard to read. Check the physical label carefully."
              : "Reading without AI often gets letters wrong. Check each item against the label."}
          </p>
        )}
        {extraction.notes && <p className="text-muted">{extraction.notes}</p>}
        {lowCount > 0 && (
          <p>
            <span className="mr-1 inline-block rounded-full border border-warn-border bg-warn-soft px-2 font-bold text-warn">?</span>
            {lowCount} item{lowCount > 1 ? "s" : ""} might be misread — please check {lowCount > 1 ? "them" : "it"}.
          </p>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Product name (optional)</span>
        <input
          value={productName}
          onChange={(e) => {
            setProductName(e.target.value);
            setSaved(false);
          }}
          className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base"
        />
      </label>

      <section aria-labelledby="ing-h" className="flex flex-col gap-2">
        <h2 id="ing-h" className="font-bold">
          Ingredients <span className="font-normal text-muted">({items.length}, in label order)</span>
        </h2>
        {items.length === 0 && (
          <p className="text-sm text-muted">No ingredients were found. Add them below, or rescan.</p>
        )}
        <IngredientChips items={chips} onEdit={edit} onRemove={remove} onAdd={add} addLabel="Add a missed ingredient" />
      </section>

      <section aria-labelledby="alg-h" className="flex flex-col gap-2">
        <h2 id="alg-h" className="font-bold">Allergen statements</h2>
        <p className="text-sm text-muted">Lines like &ldquo;Contains: soy&rdquo; or &ldquo;May contain: milk&rdquo;.</p>
        <IngredientChips
          items={statements.map((s) => ({ id: s.id, label: s.text }))}
          onEdit={(id, text) => {
            setSaved(false);
            setStatements((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
          }}
          onRemove={(id) => {
            setSaved(false);
            setStatements((prev) => prev.filter((s) => s.id !== id));
          }}
          onAdd={(text) => {
            setSaved(false);
            setStatements((prev) => [...prev, { id: crypto.randomUUID(), text }]);
          }}
          addLabel="Add an allergen statement"
        />
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <button type="button" className="btn-primary" onClick={confirm} disabled={items.length === 0}>
          {saved ? "Saved ✓" : "This matches the label"}
        </button>
        <Link href="/scan" className="btn-secondary">
          Rescan
        </Link>
      </div>

      {saved && (
        <section className="card text-sm" aria-live="polite">
          <p className="font-semibold">Ingredient list confirmed.</p>
          <p className="mt-1 text-muted">
            Personalised analysis is the next milestone. This is what will be sent for analysis:
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-semibold text-accent">Show data</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-2 text-xs">
              {JSON.stringify(draft.extraction, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Label photo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={zoom} alt="Label photo, enlarged" className="max-h-full max-w-full rounded-lg" />
          <button type="button" className="btn-secondary absolute top-4 right-4" onClick={() => setZoom(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
