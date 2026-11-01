"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { ReadResultSchema, type ReadResult, type ReadSource } from "@/lib/read/types";
import type { DietId } from "@/lib/safety/diet";
import type { AllergenId } from "@/lib/safety/synonyms";

// Everything personal stays in this browser-local database unless the user
// explicitly opts in to sync (later milestone).

// One reviewed line of the label, as the user left it on the confirm screen.
export type ReviewedItem = {
  id: string;
  kind: "ingredient" | "statement";
  text: string; // final text after the user's checks
  read_as: string; // what the reader produced, kept for provenance
  status_when_read: string;
  checked_by_user: boolean; // edited, chose an alternative, or typed it
};

export type ScanDraft = {
  id: string;
  createdAt: number;
  photos: Blob[];
  result: ReadResult;
  source: ReadSource;
  confirmed: boolean;
  reviewed?: ReviewedItem[];
};

export type Profile = {
  id: string;
  name: string;
  allergens: AllergenId[];
  intolerances: ("lactose" | "gluten")[];
  diets: DietId[];
  conditions: string[];
  conditionsOther: string;
  goals: string[];
  medications: string; // optional; only used to flag documented food-drug interactions
  updatedAt: number;
};

interface LabelLensDB extends DBSchema {
  drafts: { key: string; value: ScanDraft };
  profiles: { key: string; value: Profile };
  settings: { key: string; value: { key: string; value: string } };
}

let dbPromise: Promise<IDBPDatabase<LabelLensDB>> | null = null;

function db() {
  dbPromise ??= openDB<LabelLensDB>("labellens", 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 2) {
        // v1 drafts used the old single-reader format; they are discarded.
        if (oldVersion === 1) d.deleteObjectStore("drafts");
        d.createObjectStore("drafts", { keyPath: "id" });
      }
      if (oldVersion < 3) {
        d.createObjectStore("profiles", { keyPath: "id" });
        d.createObjectStore("settings", { keyPath: "key" });
      }
    },
  });
  return dbPromise;
}

const CURRENT = "current";

export async function saveDraft(draft: Omit<ScanDraft, "id">) {
  await (await db()).put("drafts", { ...draft, id: CURRENT });
}

export async function loadDraft(): Promise<ScanDraft | undefined> {
  const d = await (await db()).get("drafts", CURRENT);
  // Never render a stored result whose shape no longer matches.
  return d && ReadResultSchema.safeParse(d.result).success ? d : undefined;
}

export async function listProfiles(): Promise<Profile[]> {
  return (await (await db()).getAll("profiles")).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveProfile(p: Profile) {
  await (await db()).put("profiles", { ...p, updatedAt: Date.now() });
}

export async function deleteProfile(id: string) {
  await (await db()).delete("profiles", id);
}

export async function getActiveProfileId(): Promise<string | null> {
  return (await (await db()).get("settings", "activeProfile"))?.value ?? null;
}

export async function setActiveProfileId(id: string) {
  await (await db()).put("settings", { key: "activeProfile", value: id });
}

export async function getActiveProfile(): Promise<Profile | null> {
  const id = await getActiveProfileId();
  const all = await listProfiles();
  return all.find((p) => p.id === id) ?? all[0] ?? null;
}

export async function deleteAllLocalData() {
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("labellens");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
