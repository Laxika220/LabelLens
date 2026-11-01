"""Build the word lexicon used to judge whether an OCR word is plausible.

Sources (independent of the evaluation labels):
- Open Food Facts taxonomies (ingredients, additives, allergens), English
  and international names. Data licence: ODbL, (c) Open Food Facts
  contributors, https://world.openfoodfacts.org
- A general English word list (Webster's 2nd, public domain; /usr/share/dict/web2
  on macOS), lower-case entries only, so proper nouns are excluded.

The curated Indian terms live in app/data/indian_terms.txt and are loaded
separately at runtime.

Usage: python scripts/build_lexicon.py <off_dir> [/usr/share/dict/web2]
"""

import gzip
import json
import re
import sys
from pathlib import Path

off_dir = Path(sys.argv[1])
dict_path = Path(sys.argv[2] if len(sys.argv) > 2 else "/usr/share/dict/web2")
words: set[str] = set()
for name in ("ingredients", "additives", "allergens"):
    for v in json.loads((off_dir / f"{name}.json").read_text()).values():
        for lang in ("en", "xx"):
            n = v.get("name", {}).get(lang)
            if isinstance(n, str):
                words.update(re.findall(r"[a-z]+", n.lower()))
english = {
    line for line in dict_path.read_text().splitlines()
    if line.islower() and line.isalpha() and len(line) <= 20
}
data = Path(__file__).resolve().parent.parent / "app" / "data"
for name, ws in (("food_words", words), ("english_words", english - words)):
    with gzip.open(data / f"{name}.txt.gz", "wt") as f:
        f.write("\n".join(sorted(ws)))
    print(f"{name}: {len(ws)} words")
