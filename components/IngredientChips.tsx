"use client";

import { useState } from "react";

export const LOW_CONFIDENCE = 0.75;

export type ChipItem = {
  id: string;
  label: string;
  lowConfidence?: boolean;
  children?: ChipItem[];
};

function Chip({
  item,
  onEdit,
  onRemove,
  small,
}: {
  item: ChipItem;
  onEdit: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  small?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);

  const save = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== item.label) onEdit(item.id, next);
    else setDraft(item.label);
  };

  const tone = item.lowConfidence
    ? "border-warn-border bg-warn-soft text-fg"
    : "border-border bg-surface text-fg";

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(item.label);
            setEditing(false);
          }
        }}
        aria-label={`Edit ${item.label}`}
        className="min-h-11 w-full rounded-full border-2 border-accent bg-surface px-4 text-base"
      />
    );
  }

  return (
    <span className={`inline-flex max-w-full items-stretch rounded-full border ${tone} ${small ? "text-sm" : "text-base"}`}>
      <button
        type="button"
        onClick={() => {
          setDraft(item.label);
          setEditing(true);
        }}
        className={`min-h-11 truncate rounded-l-full pr-1 text-left ${small ? "pl-3" : "pl-4"}`}
        aria-label={`${item.label}${item.lowConfidence ? ", low confidence, please check" : ""}. Tap to edit`}
      >
        {item.lowConfidence && (
          <span aria-hidden className="mr-1 font-bold text-warn">
            ?
          </span>
        )}
        {item.label}
      </button>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.label}`}
        className="min-h-11 min-w-11 rounded-r-full text-xl leading-none text-muted hover:text-fg"
      >
        ×
      </button>
    </span>
  );
}

export function IngredientChips({
  items,
  onEdit,
  onRemove,
  onAdd,
  addLabel,
}: {
  items: ChipItem[];
  onEdit: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onAdd: (label: string) => void;
  addLabel: string;
}) {
  const [adding, setAdding] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2">
            <Chip item={item} onEdit={onEdit} onRemove={onRemove} />
            {item.children && item.children.length > 0 && (
              <ul aria-label={`Contains`} className="ml-4 flex flex-wrap gap-2 border-l-2 border-border pl-3">
                {item.children.map((c) => (
                  <li key={c.id}>
                    <Chip item={c} onEdit={onEdit} onRemove={onRemove} small />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim()) onAdd(adding.trim());
          setAdding("");
        }}
      >
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder={addLabel}
          aria-label={addLabel}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-base"
        />
        <button type="submit" className="btn-secondary px-4" disabled={!adding.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
