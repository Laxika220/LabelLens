"use client";

import { newId } from "@/lib/id";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ALLERGEN_OPTIONS } from "@/lib/safety/allergen-matcher";
import { DIET_LABEL, type DietId } from "@/lib/safety/diet";
import {
  deleteAllLocalData,
  deleteProfile,
  getActiveProfileId,
  listProfiles,
  saveProfile,
  setActiveProfileId,
  type Profile,
} from "@/lib/storage/indexeddb";

const CONDITIONS = [
  "Type 2 diabetes", "Prediabetes", "High blood pressure", "High LDL cholesterol", "PCOS", "IBS", "Coeliac disease",
  "Kidney disease", "Gout", "Thyroid condition", "Pregnancy", "Breastfeeding", "Phenylketonuria (PKU)",
  "Eating disorder (in recovery)", "Child under 5",
];
const GOALS = [
  "Fewer blood sugar spikes", "Less sodium", "Heart health", "Gut health", "Muscle gain", "Weight management",
  "Less ultra-processed food", "Just curious",
];

const empty = (): Profile => ({
  id: newId(),
  name: "Me",
  allergens: [],
  intolerances: [],
  diets: [],
  conditions: [],
  conditionsOther: "",
  goals: [],
  medications: "",
  updatedAt: Date.now(),
});

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function CheckGroup<T extends string>({ legend, options, value, onChange }: {
  legend: string;
  options: { id: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset className="card flex flex-col gap-1">
      <legend className="px-1 font-bold">{legend}</legend>
      {options.map((o) => (
        <label key={o.id} className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="h-5 w-5" checked={value.includes(o.id)} onChange={() => onChange(toggle(value, o.id))} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export default function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [current, setCurrent] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function refresh(selectId?: string) {
    const all = await listProfiles();
    const active = selectId ?? (await getActiveProfileId());
    setProfiles(all);
    setCurrent(all.find((p) => p.id === active) ?? all[0] ?? empty());
  }
  useEffect(() => {
    refresh();
  }, []);

  if (!profiles || !current) return <p className="pt-6 text-muted">Loading…</p>;
  const set = (patch: Partial<Profile>) => {
    setSaved(false);
    setCurrent({ ...current, ...patch });
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Health profile</h1>
        <p className="text-muted">
          Stored only on this phone. It is never uploaded: allergen and diet checks run on your device.
        </p>
      </header>

      {profiles.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Profiles">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === current.id}
              className={`min-h-11 rounded-full border px-4 ${p.id === current.id ? "border-accent bg-accent-soft font-bold" : "border-border"}`}
              onClick={() => setCurrent(p)}
            >
              {p.name}
            </button>
          ))}
          <button type="button" className="min-h-11 rounded-full border border-dashed border-border px-4" onClick={() => setCurrent({ ...empty(), name: "" })}>
            + Add profile
          </button>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-semibold">Profile name</span>
        <input value={current.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Me, Dad, Child"
          className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base" />
      </label>

      <CheckGroup legend="Allergies" options={ALLERGEN_OPTIONS} value={current.allergens} onChange={(allergens) => set({ allergens })} />
      <CheckGroup
        legend="Intolerances"
        options={[{ id: "lactose", label: "Lactose" }, { id: "gluten", label: "Gluten (non-coeliac sensitivity)" }]}
        value={current.intolerances}
        onChange={(intolerances) => set({ intolerances })}
      />
      <CheckGroup
        legend="Dietary pattern"
        options={(Object.keys(DIET_LABEL) as DietId[]).map((id) => ({ id, label: DIET_LABEL[id] }))}
        value={current.diets}
        onChange={(diets) => set({ diets })}
      />
      <CheckGroup legend="Health conditions" options={CONDITIONS.map((c) => ({ id: c, label: c }))} value={current.conditions} onChange={(conditions) => set({ conditions })} />
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Other conditions (optional)</span>
        <input value={current.conditionsOther} onChange={(e) => set({ conditionsOther: e.target.value })}
          className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base" />
      </label>
      <CheckGroup legend="Goals" options={GOALS.map((g) => ({ id: g, label: g }))} value={current.goals} onChange={(goals) => set({ goals })} />
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Medications (optional)</span>
        <span className="text-sm text-muted">Only used to point out well-documented food–medicine interactions to discuss with your doctor or pharmacist. Never to suggest changing medication.</span>
        <textarea value={current.medications} onChange={(e) => set({ medications: e.target.value })} rows={2}
          className="rounded-xl border border-border bg-surface p-3 text-base" />
      </label>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          className="btn-primary"
          disabled={!current.name.trim()}
          onClick={async () => {
            await saveProfile(current);
            await setActiveProfileId(current.id);
            await refresh(current.id);
            setSaved(true);
          }}
        >
          {saved ? "Saved ✓" : "Save and use this profile"}
        </button>
        <Link href="/scan" className="btn-secondary">Scan a label</Link>
      </div>

      {profiles.some((p) => p.id === current.id) && (
        <button type="button" className="text-left text-sm text-danger underline" onClick={async () => {
          if (!window.confirm(`Delete the profile "${current.name}"?`)) return;
          await deleteProfile(current.id);
          await refresh();
        }}>
          Delete this profile
        </button>
      )}

      <section className="card text-sm">
        <h2 className="font-bold">Your data</h2>
        <p className="mt-1 text-muted">Profiles, scans and photos are kept in this browser only. Photos sent for reading are deleted by the server straight after.</p>
        <button
          type="button"
          className="mt-2 min-h-11 rounded-lg border border-danger px-3 font-semibold text-danger"
          onClick={async () => {
            if (!window.confirm("Delete all profiles, scans and photos stored by LabelLens on this device?")) return;
            await deleteAllLocalData();
            setDeleted(true);
            await refresh();
          }}
        >
          Delete all my data
        </button>
        {deleted && <p className="mt-2 font-semibold" role="status">All LabelLens data on this device was deleted.</p>}
      </section>
    </div>
  );
}
