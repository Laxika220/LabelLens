// Runs tesseract.js (the app's on-device fallback engine) over the benchmark
// images and saves raw text + word confidences for scoring in Python.
// Usage: node scripts/eval-tesseract.mjs [set=synthetic]
import { createWorker } from "tesseract.js";
import fs from "node:fs";
import path from "node:path";

const set = process.argv[2] ?? "synthetic";
const evalDir = path.resolve("vision-service/eval");
const base = path.join(evalDir, set);
const outPath = path.join(evalDir, "results/raw", `${set}_tesseract.jsonl`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const rows = fs.readFileSync(path.join(base, "manifest.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
const done = new Set(
  fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).image) : [],
);

const cachePath = path.resolve(".cache/tesseract");
fs.mkdirSync(cachePath, { recursive: true });
const worker = await createWorker("eng", undefined, { cachePath });

let i = 0;
for (const r of rows) {
  i++;
  if (done.has(r.image)) continue;
  const t = Date.now();
  const { data } = await worker.recognize(path.join(base, r.image), {}, { blocks: true });
  const words = (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((w) => ({ text: w.text, conf: w.confidence, bbox: w.bbox })))),
  );
  fs.appendFileSync(
    outPath,
    JSON.stringify({ image: r.image, seconds: (Date.now() - t) / 1000, text: data.text, words }) + "\n",
  );
  console.log(`[${i}/${rows.length}] ${r.image}`);
}
await worker.terminate();
