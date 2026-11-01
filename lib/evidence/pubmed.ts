import "server-only";

// PubMed retrieval through NCBI E-utilities. Every source returned here was
// fetched from PubMed in this request, so its PMID, title, journal and year
// are real, not generated. Nothing about the user is sent: only the
// ingredient search terms.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export type StudyType =
  | "meta-analysis"
  | "systematic review"
  | "randomised controlled trial"
  | "review"
  | "observational study"
  | "other";

export type PubMedSource = {
  id: string; // "pmid:12345"
  pmid: string;
  doi: string | null;
  title: string;
  journal: string;
  year: number | null;
  study_type: StudyType;
  population: "humans" | "animals" | "in vitro / other" | "unknown";
  abstract: string;
  url: string;
  retrieved: string; // ISO date
};

function params(extra: Record<string, string>) {
  const p = new URLSearchParams({ db: "pubmed", tool: "labellens", ...extra });
  if (process.env.NCBI_API_KEY) p.set("api_key", process.env.NCBI_API_KEY);
  return p;
}

async function get(path: string, p: URLSearchParams): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${EUTILS}/${path}?${p}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (res.ok) return res;
    if (res.status !== 429 && res.status < 500) throw new Error(`PubMed ${path} ${res.status}`);
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(`PubMed ${path} unavailable`);
}

/** Search query preferring evidence syntheses and trials in humans. */
export function buildQuery(ingredient: string, topic?: string, strict = true): string {
  const name = ingredient.replace(/["[\]]/g, "");
  const parts = [`"${name}"[tiab]`];
  if (topic) parts.push(`(${topic.replace(/["[\]]/g, "")})`);
  if (strict) {
    parts.push("(systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt])");
  }
  parts.push('("2005"[dp] : "3000"[dp])');
  return parts.join(" AND ");
}

export async function searchPubMed(query: string, max = 6): Promise<string[]> {
  const res = await get("esearch.fcgi", params({ term: query, retmode: "json", retmax: String(max), sort: "relevance" }));
  const body = await res.json();
  return body.esearchresult?.idlist ?? [];
}

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function studyType(pubTypes: string[]): StudyType {
  const t = pubTypes.map((p) => p.toLowerCase());
  if (t.includes("meta-analysis")) return "meta-analysis";
  if (t.includes("systematic review")) return "systematic review";
  if (t.includes("randomized controlled trial")) return "randomised controlled trial";
  if (t.includes("review")) return "review";
  if (t.some((p) => p.includes("observational"))) return "observational study";
  return "other";
}

function population(mesh: string[]): PubMedSource["population"] {
  if (mesh.includes("Humans")) return "humans";
  if (mesh.includes("Animals")) return "animals";
  if (mesh.some((m) => m.includes("In Vitro") || m === "Cell Line")) return "in vitro / other";
  return "unknown";
}

/** Fetch full records (title, journal, year, type, MeSH, abstract, DOI). */
export async function fetchRecords(pmids: string[]): Promise<PubMedSource[]> {
  if (!pmids.length) return [];
  const res = await get("efetch.fcgi", params({ id: pmids.join(","), retmode: "xml", rettype: "abstract" }));
  const xml = await res.text();
  const retrieved = new Date().toISOString().slice(0, 10);
  const articles = xml.split(/<PubmedArticle>/).slice(1);
  return articles.map((a) => {
    const pick = (re: RegExp) => decode(a.match(re)?.[1] ?? "");
    const pmid = pick(/<PMID[^>]*>(\d+)<\/PMID>/);
    const year = Number(pick(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || pick(/<MedlineDate>(\d{4})/)) || null;
    const abstract = [...a.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => {
        const label = m[1].match(/Label="([^"]+)"/)?.[1];
        return (label ? `${label}: ` : "") + decode(m[2]);
      })
      .join(" ");
    const pubTypes = [...a.matchAll(/<PublicationType[^>]*>([^<]+)<\/PublicationType>/g)].map((m) => m[1]);
    const mesh = [...a.matchAll(/<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g)].map((m) => m[1]);
    const doi = a.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1] ?? null;
    return {
      id: `pmid:${pmid}`,
      pmid,
      doi,
      title: pick(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/),
      journal: pick(/<Title>([\s\S]*?)<\/Title>/),
      year,
      study_type: studyType(pubTypes),
      population: population(mesh),
      abstract,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      retrieved,
    };
  });
}

/**
 * Evidence for one ingredient (optionally about one topic, e.g. "blood
 * glucose"). Tries syntheses and trials first; if none exist, falls back to
 * any study type so the user can see that only weaker evidence exists.
 */
export async function findEvidence(ingredient: string, topic?: string, max = 6) {
  let ids = await searchPubMed(buildQuery(ingredient, topic, true), max);
  let tier: "syntheses and trials" | "any study type" = "syntheses and trials";
  if (ids.length === 0) {
    ids = await searchPubMed(buildQuery(ingredient, topic, false), max);
    tier = "any study type";
  }
  return { tier, sources: await fetchRecords(ids) };
}
