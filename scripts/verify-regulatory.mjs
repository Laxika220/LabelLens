// Verifies lib/kb/regulatory-updates.source.json against the live sources
// and writes lib/kb/regulatory-updates.json with only the entries that pass.
import fs from "node:fs";

const src = JSON.parse(fs.readFileSync("lib/kb/regulatory-updates.source.json", "utf8"));
const checked = new Date().toISOString().slice(0, 10);
const ok = [];
for (const e of src.entries) {
  let text = "";
  let pass = false;
  if (e.doi) {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(e.doi)}`);
    if (res.ok) {
      const m = (await res.json()).message;
      const title = (m.title ?? [""])[0];
      text = `${title} ${m.abstract ?? ""}`;
      pass = title.toLowerCase().includes(e.title.toLowerCase().slice(0, 30));
      // The abstract isn't always in Crossref and publishers often block
      // automated reads, so the summary is checked against the authority's
      // own page (verify_url) when one is given.
      if (pass && e.verify_url) {
        const page = await fetch(e.verify_url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 LabelLens-verifier" } });
        text += page.ok ? await page.text() : "";
      }
    }
  } else if (e.url) {
    const res = await fetch(e.url, { redirect: "follow" });
    text = res.ok ? await res.text() : "";
    pass = res.ok;
  }
  const missing = (e.must_contain ?? []).filter((p) => !text.toLowerCase().includes(p.toLowerCase()));
  if (pass && missing.length === 0) {
    const { must_contain: _m, verify_url: _v, ...rest } = e;
    ok.push({ ...rest, url: e.url ?? `https://doi.org/${e.doi}`, verified: { checked, method: e.doi && e.verify_url ? "crossref + authority page" : e.doi ? "crossref" : "page text" } });
    console.log(`verified ${e.code} ${e.authority}`);
  } else {
    console.log(`NOT verified ${e.code} ${e.authority}: ${pass ? `missing phrases ${JSON.stringify(missing)}` : "source not found"}`);
  }
}
fs.writeFileSync("lib/kb/regulatory-updates.json", JSON.stringify({ checked, entries: ok }, null, 1));
