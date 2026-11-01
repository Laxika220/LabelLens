"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { matchAllergens, type AllergenAlert, type LabelLine } from "@/lib/safety/allergen-matcher";
import { matchDiets, type DietAlert } from "@/lib/safety/diet";
import { ALLERGENS, type AllergenId } from "@/lib/safety/synonyms";
import { getActiveProfile, type Profile } from "@/lib/storage/indexeddb";

const LEVEL_TEXT: Record<AllergenAlert["level"], string> = {
  contains: "Contains",
  may_contain: "May contain",
  source_unknown: "Source not stated",
  cannot_rule_out: "Can't rule out",
};

const HIGH_RISK = ["Pregnancy", "Breastfeeding", "Child under 5", "Kidney disease", "Phenylketonuria (PKU)"];

function AlertRow({ title, level, detail, ingredient }: { title: string; level: string; detail: string; ingredient: string | null }) {
  const strong = level === "Contains" || level === "May contain";
  return (
    <li className={`rounded-xl border-2 p-3 ${strong ? "border-danger bg-danger-soft" : "border-warn-border bg-warn-soft"}`}>
      <p className="font-bold">
        {level}: {title}
      </p>
      {ingredient && <p className="text-sm">From: &ldquo;{ingredient}&rdquo;</p>}
      <p className="text-sm">{detail}</p>
    </li>
  );
}

export function SafetyPanel({ lines, readIncomplete }: { lines: LabelLine[]; readIncomplete: boolean }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => {
    getActiveProfile().then(setProfile);
  }, []);
  if (profile === undefined) return null;

  // Allergens declared or present for anyone, shown even without a profile.
  const declared = matchAllergens(lines, ALLERGENS.map((a) => a.id), false).filter((a) => a.level === "contains" || a.level === "may_contain");
  const declaredSummary = [...new Map(declared.map((a) => [`${a.allergen}:${a.level}`, a])).values()];

  if (!profile) {
    return (
      <section className="card flex flex-col gap-2 text-sm" aria-labelledby="safety-h">
        <h2 id="safety-h" className="font-bold">Allergens on this label</h2>
        <p>{declaredSummary.length ? declaredSummary.map((a) => `${LEVEL_TEXT[a.level]} ${a.label.toLowerCase()}`).join(" · ") : "None found in the confirmed text."}</p>
        {readIncomplete && <p className="font-semibold">Part of the label couldn&apos;t be read, so others can&apos;t be ruled out.</p>}
        <Link href="/profile" className="font-semibold text-accent underline">Add your allergies and diet for personal checks</Link>
      </section>
    );
  }

  const avoid = [...new Set<AllergenId>([
    ...profile.allergens,
    ...(profile.intolerances.includes("lactose") ? (["milk"] as const) : []),
    ...(profile.intolerances.includes("gluten") || profile.conditions.includes("Coeliac disease") ? (["gluten"] as const) : []),
  ])];
  const allergenAlerts = matchAllergens(lines, avoid, readIncomplete);
  const dietAlerts: DietAlert[] = matchDiets(lines.filter((l) => l.kind === "ingredient").map((l) => l.text), profile.diets);
  const highRisk = profile.conditions.filter((c) => HIGH_RISK.includes(c));
  const hasPkuRisk = profile.conditions.includes("Phenylketonuria (PKU)") && lines.some((l) => /aspartame|\b951\b|phenylalanine/i.test(l.text));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="safety-h">
      <h2 id="safety-h" className="text-lg font-bold">Checks for {profile.name}</h2>
      <p className="text-xs text-muted">
        Exact matching against a fixed list of allergen and diet terms, on your phone. No AI. Based only on the text you confirmed.
      </p>

      {hasPkuRisk && (
        <AlertRow title="Phenylalanine (aspartame)" level="Contains" ingredient={null}
          detail="Aspartame is a source of phenylalanine. People with PKU are advised to avoid it. Check with your clinic team." />
      )}

      {allergenAlerts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {allergenAlerts.map((a, i) => (
            <AlertRow key={i} title={a.label} level={LEVEL_TEXT[a.level]} ingredient={a.ingredient} detail={a.why} />
          ))}
        </ul>
      ) : avoid.length > 0 ? (
        <p className="card text-sm">
          None of your listed allergens ({avoid.map((a) => ALLERGENS.find((x) => x.id === a)!.label.toLowerCase()).join(", ")}) were found in the text you confirmed.
          That is not a guarantee: always read the pack, and ask the manufacturer if you&apos;re unsure.
        </p>
      ) : null}

      {dietAlerts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {dietAlerts.map((d, i) => (
            <AlertRow key={i} title={`${d.label}: ${d.term}`} level={d.level === "contains" ? "Doesn't fit" : "Source not stated"} ingredient={d.ingredient} detail={d.why} />
          ))}
        </ul>
      )}

      {(highRisk.length > 0 || profile.medications.trim()) && (
        <p className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
          {highRisk.length > 0 && <>Because your profile includes {highRisk.join(", ").toLowerCase()}, please check food choices with your doctor or dietitian. </>}
          {profile.medications.trim() && <>You listed medications: ask your doctor or pharmacist about any food interactions. Don&apos;t change medication based on this app.</>}
        </p>
      )}
    </section>
  );
}
