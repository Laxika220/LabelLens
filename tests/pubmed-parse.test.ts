import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fetchRecords } from "@/lib/evidence/pubmed";

// Real efetch output for PMIDs 17825405 and 25731162, saved as a fixture.
const xml = fs.readFileSync(path.join(__dirname, "fixtures/pubmed-efetch.xml"), "utf8");

afterEach(() => vi.unstubAllGlobals());

it("parses real PubMed records, including study population", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })));
  const [trial, mice] = await fetchRecords(["17825405", "25731162"]);

  expect(trial.pmid).toBe("17825405");
  expect(trial.title).toMatch(/Food additives and hyperactive behaviour/i);
  expect(trial.journal).toMatch(/Lancet/i);
  expect(trial.year).toBe(2007);
  expect(trial.study_type).toBe("randomised controlled trial");
  expect(trial.population).toBe("humans");
  expect(trial.abstract.length).toBeGreaterThan(200);

  expect(mice.pmid).toBe("25731162");
  expect(mice.journal).toMatch(/Nature/i);
  expect(mice.population).toBe("animals"); // must not be presented as human evidence
  expect(mice.doi).toMatch(/^10\./);
});
