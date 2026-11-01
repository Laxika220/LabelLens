"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { ReadResultSchema, type ReadResult, type ReadSource } from "@/lib/read/types";

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

interface LabelLensDB extends DBSchema {
  drafts: { key: string; value: ScanDraft };
}

let dbPromise: Promise<IDBPDatabase<LabelLensDB>> | null = null;

function db() {
  dbPromise ??= openDB<LabelLensDB>("labellens", 2, {
    upgrade(d, oldVersion) {
      // v1 drafts used the old single-reader format; they are discarded.
      if (oldVersion >= 1) d.deleteObjectStore("drafts");
      d.createObjectStore("drafts", { keyPath: "id" });
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

export async function deleteAllLocalData() {
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("labellens");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
