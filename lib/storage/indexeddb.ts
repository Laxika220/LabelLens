"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Extraction } from "@/lib/ai/schemas";

// Everything personal stays in this browser-local database unless the user
// explicitly opts in to sync (milestone 2+).

export type ExtractionSource = "claude" | "on-device" | "manual";

export type ScanDraft = {
  id: string;
  createdAt: number;
  photos: Blob[];
  extraction: Extraction;
  source: ExtractionSource;
  confirmed: boolean;
};

interface LabelLensDB extends DBSchema {
  drafts: { key: string; value: ScanDraft };
}

let dbPromise: Promise<IDBPDatabase<LabelLensDB>> | null = null;

function db() {
  dbPromise ??= openDB<LabelLensDB>("labellens", 1, {
    upgrade(d) {
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
  return (await db()).get("drafts", CURRENT);
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
