#!/usr/bin/env bash
# LineHunter Studio: local test photos (never committed, only shown on localhost).
# Copies every .jpg / .jpeg / .png / .webp from a folder into studio/photos/local/ and writes local.json for the Studio's photo picker.
# Name each file after the player: "Jalen Brunson.jpg", "jalenbrunson2.webp", "brunson.png", "stephcurry.jpg" and nicknames (sga, wemby, luka...)
# are matched to the real name from js/data/nbaIds.js, so the Studio can pick the photo for that player.
# A file named "Player Name -- Credit text.jpg" prints "Photo: Credit text" on the card.
# Usage (from the repo root):  bash studio/tools/local-photos.sh ["$HOME/Downloads/Studio Photos"]
set -euo pipefail
SRC="${1:-$HOME/Downloads/Studio Photos}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/studio/photos/local"
[ -d "$SRC" ] || { echo "No folder at: $SRC"; exit 1; }
mkdir -p "$DEST"
find "$DEST" -maxdepth 1 -type f ! -name local.json -delete
python3 - "$SRC" "$DEST" "$ROOT/js/data/nbaIds.js" <<'PY'
import json, os, re, shutil, sys
src, dest, ids_file = sys.argv[1:4]
# Every active player's name (js/data/nbaIds.js keys: lowercase, no accents or punctuation), to turn a file name into the real name.
names = re.findall(r'"([a-z][a-z .\'-]+)":\d+', open(ids_file).read()) if os.path.exists(ids_file) else []
ALIASES = {"sga": "shai gilgeous alexander", "shai": "shai gilgeous alexander", "steph": "stephen curry", "wemby": "victor wembanyama",
           "kd": "kevin durant", "lebron": "lebron james", "bron": "lebron james", "giannis": "giannis antetokounmpo", "jokic": "nikola jokic",
           "luka": "luka doncic", "ant": "anthony edwards", "jt": "jayson tatum", "cp3": "chris paul", "ad": "anthony davis", "dame": "damian lillard"}
squash = lambda t: re.sub(r"[^a-z]", "", t.lower())
def resolve(raw):
    c = squash(re.sub(r"\d+", "", raw))
    if not c: return None
    if c in ALIASES: return ALIASES[c]
    full = [n for n in names if squash(n) == c]
    if full: return full[0]
    parts = lambda n: (n.split()[0], squash(" ".join(n.split()[1:])))
    # "wembanyama", "doncic", "cade", or "stephcurry" = (start of the first name) + last name
    for test in (lambda f, l: l == c, lambda f, l: f == c, lambda f, l: c.endswith(l) and len(c) > len(l) and f.startswith(c[: len(c) - len(l)])):
        hits = [n for n in names if test(*parts(n))]
        if len(hits) == 1: return hits[0]
    return None
title = lambda n: " ".join(w.capitalize() for w in n.split())
out = []
for f in sorted(os.listdir(src)):
    base, ext = os.path.splitext(f)
    if ext.lower() not in (".jpg", ".jpeg", ".png", ".webp") or f.startswith("."):
        continue
    name, _, credit = base.partition(" -- ")
    real = resolve(name)
    shown = title(real) if real else re.sub(r"\s+", " ", re.sub(r"[-_\d]+", " ", name)).strip().title()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", f)
    shutil.copy2(os.path.join(src, f), os.path.join(dest, safe))
    out.append({"player": shown, "file": safe, "credit": credit.strip()})
json.dump(out, open(os.path.join(dest, "local.json"), "w"), indent=1)
print(f"{len(out)} photo(s) ready:")
for p in out: print(f"  {p['player']:<28} {p['file']}" + (f"  (credit: {p['credit']})" if p["credit"] else ""))
unknown = [p["file"] for p in out if not any(p["player"].lower() == n for n in names)]
if unknown: print("Not matched to a player (rename like 'Jalen Brunson.jpg'):", ", ".join(unknown))
PY
