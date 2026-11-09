#!/usr/bin/env bash
# LineHunter Studio: local test photos (never committed, only shown on localhost).
# Copies every .jpg / .jpeg / .png / .webp from a folder into studio/photos/local/ and writes local.json for the Studio's photo picker.
# Name each file after the player ("Jalen Brunson.jpg", "jalen-brunson.webp", "jalen_brunson 2.png") so the Studio can match it.
# A file named "Player Name -- Credit text.jpg" prints "Photo: Credit text" on the card.
# Usage (from the repo root):  bash studio/tools/local-photos.sh ["$HOME/Downloads/Studio Photos"]
set -euo pipefail
SRC="${1:-$HOME/Downloads/Studio Photos}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/studio/photos/local"
[ -d "$SRC" ] || { echo "No folder at: $SRC"; exit 1; }
mkdir -p "$DEST"
find "$DEST" -maxdepth 1 -type f ! -name local.json -delete
python3 - "$SRC" "$DEST" <<'PY'
import json, os, re, shutil, sys
src, dest = sys.argv[1], sys.argv[2]
out = []
for f in sorted(os.listdir(src)):
    base, ext = os.path.splitext(f)
    if ext.lower() not in (".jpg", ".jpeg", ".png", ".webp") or f.startswith("."):
        continue
    name, _, credit = base.partition(" -- ")
    name = re.sub(r"[-_]+", " ", name)
    name = re.sub(r"\s+\d+$", "", name).strip()          # "Jalen Brunson 2" -> "Jalen Brunson"
    name = " ".join(w if w[:1].isupper() else w.capitalize() for w in name.split())
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", f)
    shutil.copy2(os.path.join(src, f), os.path.join(dest, safe))
    out.append({"player": name, "file": safe, "credit": credit.strip()})
json.dump(out, open(os.path.join(dest, "local.json"), "w"), indent=1)
print(f"{len(out)} photo(s) ready:")
for p in out: print(f"  {p['player']:<28} {p['file']}" + (f"  (credit: {p['credit']})" if p["credit"] else ""))
PY
