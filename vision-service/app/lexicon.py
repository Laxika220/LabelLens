"""Is an OCR word plausible label text?

Agreement between preprocessing variants is not independent evidence: they
all run the same OCR model, so they tend to make the SAME mistake (e.g. all
reading "Iodised" as "lodised"). A word therefore can only be "confirmed"
if it is also plausible: a known word, or a valid number / additive code.

This is a necessary check, not a sufficient one: an OCR error that produces
another real word ("Coma" for "Cocoa") passes it. Those are caught, when
they are caught, by disagreement between readings.

Suggested corrections are only suggestions. They are shown to the user and
never applied automatically.
"""

import gzip
import re
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent / "data"

NUMBER = re.compile(r"^\d+([.,]\d+)?%?$")  # 24, 3.2%, 0,5
ADDITIVE = re.compile(r"^(e|ins)?\d{3,4}[a-f]?$")  # 322, 150d, 472e, E471, INS322
ROMAN = re.compile(r"^[ivx]{1,4}$")  # the (ii) in 503(ii)
VITAMIN = re.compile(r"^[a-z]\d{1,2}$")  # B12, D3
SPLIT = re.compile(r"[()\[\]{},.;:/&+\-\"'%]+")

# Character pairs OCR commonly confuses, used only to suggest corrections.
CONFUSIONS = [("l", "i"), ("i", "l"), ("1", "l"), ("l", "1"), ("0", "o"), ("o", "0"), ("rn", "m"), ("m", "rn"),
              ("cl", "d"), ("vv", "w"), ("5", "s"), ("s", "5"), ("8", "b"), ("6", "b"), ("c", "e"), ("e", "c"), ("ii", "u")]


def _load(name: str) -> set[str]:
    with gzip.open(DATA / f"{name}.txt.gz", "rt") as f:
        return set(f.read().split())


@lru_cache(maxsize=4)
def words(include_indian: bool = True, food_only: bool = False) -> frozenset[str]:
    """Open Food Facts food words (+ curated Indian terms), plus general
    English unless food_only is set."""
    base = _load("food_words")
    if include_indian:
        for line in (DATA / "indian_terms.txt").read_text().splitlines():
            if not line.startswith("#"):
                base.update(line.lower().split())
    if not food_only:
        base |= _load("english_words")
    return frozenset(base)


def _known_word(w: str, lex: frozenset[str]) -> bool:
    if w in lex:
        return True
    stems = []
    for suffix, repl in (("ies", "y"), ("es", ""), ("s", ""), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"), ("ied", "y")):
        if w.endswith(suffix) and len(w) - len(suffix) >= 3:
            stems.append(w[: -len(suffix)] + repl)
    stems += [w.replace("is", "iz"), w.replace("iz", "is"), w.replace("our", "or")]  # British/US spelling
    return any(s in lex for s in stems)


def part_ok(part: str, lex: frozenset[str]) -> bool:
    p = part.lower()
    if not p:
        return True
    if NUMBER.match(p) or ADDITIVE.match(p) or ROMAN.match(p) or VITAMIN.match(p):
        return True
    if len(p) == 1:
        return p.isalpha()
    return p.isalpha() and _known_word(p, lex)


def plausible(word: str, include_indian: bool = True, food_only: bool = False) -> bool:
    lex = words(include_indian, food_only)
    return all(part_ok(p, lex) for p in SPLIT.split(word))


def suggestions(word: str, include_indian: bool = True, limit: int = 3) -> list[str]:
    """Plausible spellings one or two look-alike substitutions away. Only
    food vocabulary (not general English) is suggested, to avoid offering
    unrelated real words."""
    if plausible(word, include_indian):
        return []
    seen, out = {word}, []
    frontier = [word]
    for _ in range(2):
        nxt = []
        for cand in frontier:
            low = cand.lower()
            for a, b in CONFUSIONS:
                start = low.find(a)
                while start != -1:
                    new = cand[:start] + _match_case(cand[start:start + len(a)], b) + cand[start + len(a):]
                    if new not in seen:
                        seen.add(new)
                        nxt.append(new)
                        if plausible(new, include_indian, food_only=True):
                            out.append(new)
                    start = low.find(a, start + 1)
        if out:
            break
        frontier = nxt[:200]
    return out[:limit]


def _match_case(src: str, repl: str) -> str:
    return repl.upper() if src.isupper() and repl.isalpha() else repl
