"""Accuracy metrics for ingredient-label OCR.

- CER / WER: edit distance between predicted and true text, divided by the
  length of the true text (characters / words). Lower is better; 0 = perfect.
  Comparison ignores letter case and repeated whitespace, because case does
  not change an ingredient's meaning.
- Ingredient precision / recall: the label is split into top-level
  ingredients (bracket-aware, same rules as the app) and items are matched
  exactly after normalisation. Recall matters most: a missed ingredient is
  worse than an extra one the user can delete.
- Allergen-term recall: share of allergen-bearing terms from the ground
  truth that appear correctly in the prediction.
"""

import re
import unicodedata


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip()


def levenshtein(a, b) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(pred: str, truth: str) -> float:
    p, t = normalise(pred), normalise(truth)
    return levenshtein(p, t) / max(1, len(t))


def wer(pred: str, truth: str) -> float:
    p, t = normalise(pred).split(), normalise(truth).split()
    return levenshtein(p, t) / max(1, len(t))


STATEMENT = re.compile(
    r"\b(contains|may contain|allergy advice|made in a facility|prepared in a unit|not recommended|not for use)\b.*",
    re.I | re.S,
)


def split_top_level(text: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)
        if ch in ",;" and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [s.strip(" .") for s in out if s.strip(" .")]


def ingredients(text: str) -> list[str]:
    """Top-level ingredient items, normalised, with allergen statements removed."""
    t = normalise(text)
    m = re.search(r"ingredients?\s*[:\-]\s*", t)
    if m:
        t = t[m.end():]
    t = STATEMENT.split(t)[0]
    items = split_top_level(t)
    return [re.sub(r"\s*([()\[\],%])\s*", r"\1", i) for i in items]


def ingredient_scores(pred: str, truth: str) -> dict:
    p, t = ingredients(pred), ingredients(truth)
    remaining = list(p)
    hits = 0
    for item in t:
        if item in remaining:
            remaining.remove(item)
            hits += 1
    return {
        "precision": hits / len(p) if p else 0.0,
        "recall": hits / len(t) if t else 1.0,
        "exact_list": p == t,
        "true_count": len(t),
        "missed": [i for i in t if i not in p],
    }


def allergen_recall(pred: str, allergen_terms: list[str]) -> float | None:
    if not allergen_terms:
        return None
    p = re.sub(r"\s*([()\[\],])\s*", r"\1", normalise(pred))
    found = sum(1 for a in allergen_terms if re.sub(r"\s*([()\[\],])\s*", r"\1", normalise(a)) in p)
    return found / len(allergen_terms)


def score(pred: str, truth: str, allergen_terms: list[str]) -> dict:
    ing = ingredient_scores(pred, truth)
    return {
        "cer": round(cer(pred, truth), 4),
        "wer": round(wer(pred, truth), 4),
        "ing_precision": round(ing["precision"], 4),
        "ing_recall": round(ing["recall"], 4),
        "exact_list": ing["exact_list"],
        "missed": ing["missed"],
        "allergen_recall": allergen_recall(pred, allergen_terms),
    }
