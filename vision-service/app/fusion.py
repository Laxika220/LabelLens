"""Combine several readings of the same photo into one transcription with
per-word agreement.

Readings come from OCR on different preprocessing variants (and, when
available, from an independent engine). The original photo's reading is the
anchor. For each anchor line we find the same line in the other readings by
position, align the words, and count how many readings agree.

Disagreement is never silently resolved: a word that readings disagree on
keeps every alternative so the user can choose.
"""

from dataclasses import dataclass, field
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Callable

import numpy as np

# Status names shown to users (see docs/STATUSES in the web app).
CONFIRMED = "confirmed"
PROBABLE = "probable"
CONFLICTING = "conflicting"
UNREADABLE = "unreadable"
MISSING = "missing"


@dataclass
class Reading:
    """One engine/variant's lines, with boxes already in original-photo pixels."""

    source: str  # e.g. "rapidocr:original", "rapidocr:illum", "claude"
    lines: list[dict]  # {"text": str, "score": float | None, "box": [[x, y] * 4]}


@dataclass
class Word:
    text: str
    box: list[int]  # [x, y, w, h] approximate, on the original photo
    line: int
    score: float | None
    support: list[str]  # sources that read exactly this word
    covered_by: list[str]  # sources that read this line at all
    alternatives: dict[str, list[str]] = field(default_factory=dict)  # other text -> sources
    illegible_to: list[str] = field(default_factory=list)  # sources that said "can't read this"
    plausible: bool = True  # a known word / valid number or code (see lexicon.py)
    suggestions: list[str] = field(default_factory=list)  # look-alike corrections, never auto-applied
    status: str = PROBABLE


def _rect(box) -> tuple[float, float, float, float]:
    pts = np.array(box, np.float32)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    return float(x0), float(y0), float(x1), float(y1)


def _overlap(a, b) -> float:
    """Share of box b that lies inside box a."""
    ax0, ay0, ax1, ay1 = _rect(a)
    bx0, by0, bx1, by1 = _rect(b)
    iw = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    ih = max(0.0, min(ay1, by1) - max(ay0, by0))
    area = max(1.0, (bx1 - bx0) * (by1 - by0))
    return iw * ih / area


def _fold_latin(word: str) -> str:
    """Drop accents from Latin letters only ("CONTÁINS" -> "CONTAINS").
    Devanagari and other scripts are left alone: their vowel signs are
    also combining marks, and removing them would change the word."""
    out = []
    for ch in unicodedata.normalize("NFD", word):
        if unicodedata.combining(ch) and out and out[-1].isascii():
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def _key(word: str) -> str:
    """Comparison key: letters, digits, % and decimal points. Readings that
    differ only in other punctuation (a missing bracket or comma) or in an
    accent on a Latin letter agree on what the word IS, so they are not
    treated as a conflict."""
    # Remove punctuation, symbols and spaces by Unicode category. (A regex
    # like [^\w] would also delete Devanagari vowel signs, making different
    # Hindi words compare equal.)
    kept = "".join(
        ch for ch in _fold_latin(word.lower())
        if ch in "%." or unicodedata.category(ch)[0] not in "PSZ"
    )
    return re.sub(r"(?<!\d)\.|\.(?!\d)", "", kept)


def _word_boxes(line_text: str, box) -> list[list[int]]:
    """Split a line box into per-word boxes in proportion to character position."""
    x0, y0, x1, y1 = _rect(box)
    n = max(1, len(line_text))
    out, pos = [], 0
    for w in line_text.split():
        start = line_text.index(w, pos)
        end = start + len(w)
        pos = end
        out.append([int(x0 + (x1 - x0) * start / n), int(y0), int((x1 - x0) * (end - start) / n), int(y1 - y0)])
    return out


def _matching_text(anchor_box, reading: Reading) -> str | None:
    """Text of the reading's line(s) that sit on the anchor line, left to right."""
    hits = [ln for ln in reading.lines if ln["text"].strip() and _overlap(anchor_box, ln["box"]) > 0.5]
    if not hits:
        return None
    hits.sort(key=lambda ln: _rect(ln["box"])[0])
    return " ".join(ln["text"] for ln in hits)


def fuse(readings: list[Reading], anchor: str | None = None) -> list[Word]:
    """Align all readings to the anchor reading, word by word."""
    if not readings:
        return []
    by_source = {r.source: r for r in readings}
    anchor_r = by_source.get(anchor) if anchor else None
    if anchor_r is None or not anchor_r.lines:
        anchor_r = max(readings, key=lambda r: len(r.lines))
    others = [r for r in readings if r is not anchor_r]

    words: list[Word] = []
    for li, line in enumerate(anchor_r.lines):
        a_words = line["text"].split()
        if not a_words:
            continue
        boxes = _word_boxes(line["text"], line["box"])
        line_words = [
            Word(text=w, box=b, line=li, score=line.get("score"), support=[anchor_r.source], covered_by=[anchor_r.source])
            for w, b in zip(a_words, boxes)
        ]
        for other in others:
            text = _matching_text(line["box"], other)
            if text is None:
                continue
            o_words = text.split()
            for w in line_words:
                w.covered_by.append(other.source)
            sm = SequenceMatcher(a=[_key(w) for w in a_words], b=[_key(w) for w in o_words], autojunk=False)
            for op, i1, i2, j1, j2 in sm.get_opcodes():
                if op == "equal":
                    for k in range(i2 - i1):
                        line_words[i1 + k].support.append(other.source)
                elif op == "replace" and i2 - i1 == j2 - j1:
                    for k in range(i2 - i1):
                        line_words[i1 + k].alternatives.setdefault(o_words[j1 + k], []).append(other.source)
                elif op in ("replace", "delete"):
                    # Word count differs (e.g. "Milk Solids" vs "MilkSolids"):
                    # record the other reading's span against each anchor word.
                    alt = " ".join(o_words[j1:j2]) or "(nothing)"
                    for k in range(i1, i2):
                        line_words[k].alternatives.setdefault(alt, []).append(other.source)
                # "insert": the other reading has extra words; they're kept as
                # an alternative on the neighbouring word so they aren't lost.
                elif op == "insert" and line_words:
                    k = min(i1, len(line_words) - 1)
                    extra = " ".join(o_words[j1:j2])
                    line_words[k].alternatives.setdefault(f"+{extra}", []).append(other.source)
        words.extend(line_words)
    return words


def add_stream_reading(words: list[Word], source: str, other: list[str], illegible: str) -> list[str]:
    """Align a reading that has no boxes (e.g. Claude's transcription) to the
    fused words over the whole text. Words it agrees with gain support from
    an independent engine; differences become alternatives; words it marked
    illegible are recorded as such. Returns the reading's extra words that
    match nothing because the fused reading is empty."""
    for w in words:
        w.covered_by.append(source)
    sm = SequenceMatcher(a=[_key(w.text) for w in words], b=[_key(o) for o in other], autojunk=False)
    extras: list[str] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                words[i1 + k].support.append(source)
        elif op in ("replace", "delete"):
            alt = " ".join(other[j1:j2]) or "(nothing)"
            for k in range(i1, i2):
                words[k].alternatives.setdefault(alt, []).append(source)
        elif op == "insert":
            extra = " ".join(other[j1:j2])
            if words:
                # Words only this reading saw: attach to the neighbouring word so
                # the ingredient/statement they belong to is flagged.
                k = min(i1, len(words) - 1)
                words[k].alternatives.setdefault(f"+{extra}", []).append(source)
            else:
                extras.append(extra)
    for w in words:
        if any(illegible in alt for alt, srcs in w.alternatives.items() if source in srcs):
            w.illegible_to.append(source)
    return extras


def _meaningful(extra: str) -> bool:
    return bool(re.search(r"\d", extra)) or len(re.sub(r"[^a-z]", "", extra.lower())) >= 3


def assign_status(
    words: list[Word],
    low_score: float,
    high_score: float,
    min_support: float,
    plausible: Callable[[str], bool] | None = None,
    suggest: Callable[[str], list[str]] | None = None,
) -> None:
    """Give each word a status from agreement and (calibrated) score.

    - unreadable: the engine itself was unsure (score below low_score)
    - conflicting: at least one other reading saw different text here
    - confirmed: every reading that covered the line agrees, at least
      `min_support` of readings, the score is high, AND the word is
      plausible label text (readings from one engine share its mistakes,
      so agreement alone is not enough)
    - probable: everything else (e.g. agreement but only one reading)
    Thresholds come from calibration in eval/, not from guesses.
    """
    for w in words:
        if plausible is not None:
            w.plausible = plausible(w.text)
            if not w.plausible and suggest is not None:
                w.suggestions = suggest(w.text)
        # Alternatives count, including "+extra" words another reading saw
        # here (they may be a word this reading missed). Extras of one or two
        # letters are binarisation specks, not missed words; the shortest
        # allergen names ("soy", "egg") have three.
        real_alts = [k for k in w.alternatives if not k.startswith("+") or _meaningful(k[1:])]
        if (w.score is not None and w.score < low_score) or w.illegible_to:
            w.status = UNREADABLE
        elif real_alts:
            w.status = CONFLICTING
        elif (
            w.plausible
            and len(w.support) >= max(2, min_support * len(w.covered_by))
            and (w.score is None or w.score >= high_score)
        ):
            w.status = CONFIRMED
        else:
            w.status = PROBABLE


def text_of(words: list[Word]) -> str:
    return " ".join(w.text for w in words)
