// Builds lib/kb/additives.json from the Open Food Facts additives taxonomy
// (ODbL, (c) Open Food Facts contributors) and VERIFIES every EFSA link:
// each DOI is looked up in Crossref, and kept only if it exists and the
// registered title matches the evaluation it is attached to.
//
// Usage: node scripts/build-additives-kb.mjs <path/to/additives.json>
import fs from "node:fs";

const src = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const en = (v) => (v && typeof v === "object" ? v.en ?? v.xx : v) ?? null;
const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
const overlap = (a, b) => {
  const A = words(a), B = words(b);
  return [...A].filter((w) => B.has(w)).length / Math.max(1, Math.min(A.size, B.size));
};

async function crossref(doi) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": "LabelLens-kb-builder/0.1 (educational project)" },
    });
    if (res.status === 404) return null;
    if (res.ok) {
      const m = (await res.json()).message;
      const parts = m.issued?.["date-parts"]?.[0] ?? [];
      return { title: (m.title ?? [""])[0], container: (m["container-title"] ?? [""])[0], date: parts.join("-") };
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`crossref unavailable for ${doi}`);
}

const out = {};
const stats = { additives: 0, efsa_links: 0, verified: 0, rejected: [] };
const checkedAt = new Date().toISOString().slice(0, 10);
for (const [key, v] of Object.entries(src)) {
  const code = en(v.e_number);
  if (!code) continue;
  const name = (en(v.name) ?? key).replace(/^E\d+[a-z]*(\([ivx]+\))?\s*-\s*/i, "");
  const entry = {
    code: code.toUpperCase(),
    name,
    classes: (en(v.additives_classes) ?? "").split(",").map((c) => c.trim().replace(/^en:/, "")).filter(Boolean),
    vegetarian: en(v.vegetarian),
    vegan: en(v.vegan),
    efsa: null,
  };
  stats.additives++;
  const url = en(v.efsa_evaluation_url);
  const title = en(v.efsa_evaluation);
  const doi = url?.match(/10\.2903\/[^\s?#]+/)?.[0];
  if (doi && title) {
    stats.efsa_links++;
    const cr = await crossref(doi);
    if (cr && overlap(cr.title, title) >= 0.5) {
      stats.verified++;
      entry.efsa = {
        title: cr.title,
        doi,
        url: `https://doi.org/${doi}`,
        journal: cr.container,
        published: cr.date,
        adi: en(v.efsa_evaluation_adi),
        exposure_above_adi_95th: en(v.efsa_evaluation_exposure_95th_greater_than_adi),
        verified_via: "crossref",
        checked: checkedAt,
      };
    } else {
      stats.rejected.push({ code, doi, claimed: title, registered: cr?.title ?? "(DOI not found)" });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  // Several entries can share a code (E322 and its sub-types). Prefer the
  // parent entry (key en:e322); keep a sub-type's verified EFSA reference
  // only if the parent has none.
  const isParent = key === `en:e${code.toLowerCase()}`;
  const prev = out[entry.code];
  if (!prev) out[entry.code] = entry;
  else if (isParent) out[entry.code] = { ...entry, efsa: entry.efsa ?? prev.efsa };
  else if (!prev.efsa && entry.efsa) prev.efsa = entry.efsa;
}
fs.writeFileSync("lib/kb/additives.json", JSON.stringify({
  source: "Open Food Facts additives taxonomy (ODbL); EFSA links verified against Crossref",
  built: checkedAt,
  additives: out,
}));
fs.writeFileSync("lib/kb/additives-build-report.json", JSON.stringify(stats, null, 1));
console.log(`${stats.additives} additives; EFSA links ${stats.efsa_links}, verified ${stats.verified}, rejected ${stats.rejected.length}`);
