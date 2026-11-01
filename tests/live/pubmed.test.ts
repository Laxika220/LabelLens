import { expect, it } from "vitest";
import { buildQuery, findEvidence } from "@/lib/evidence/pubmed";

it("retrieves real, well-formed PubMed records", async () => {
  const r = await findEvidence("aspartame", "glucose OR insulin", 5);
  expect(r.sources.length).toBeGreaterThan(0);
  for (const s of r.sources) {
    console.log(`${s.id} | ${s.year} | ${s.study_type} | ${s.population} | ${s.title.slice(0, 70)} | abstract ${s.abstract.length} | doi ${s.doi}`);
    expect(s.pmid).toMatch(/^\d+$/);
    expect(s.title.length).toBeGreaterThan(10);
    expect(s.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`);
    expect(s.year).toBeGreaterThanOrEqual(2005);
  }
  expect(buildQuery("aspartame", undefined, true)).toContain("meta-analysis[pt]");
});

it("each returned PMID resolves on PubMed with the same title", async () => {
  const { sources } = await findEvidence("sucralose", undefined, 2);
  for (const s of sources) {
    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${s.pmid}`);
    const sum = (await res.json()).result[s.pmid];
    expect(sum.title.replace(/<[^>]+>/g, "").slice(0, 40).toLowerCase()).toBe(s.title.slice(0, 40).toLowerCase());
  }
});
