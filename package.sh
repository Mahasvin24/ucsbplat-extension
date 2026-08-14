#!/usr/bin/env bash
# Build the .zip to upload to the Chrome Web Store.
#
# There is no .chromeignore -- the Web Store takes whatever archive you hand it, so what
# ships is decided here and nowhere else. That matters more than it sounds: `sample-data/`
# holds real GOLD captures (a complete academic transcript, named), and zipping the folder
# would publish it to a listing anyone can download. This lists files explicitly rather
# than excluding them, so a new file is left out by default instead of shipped by default.
set -euo pipefail

cd "$(dirname "$0")"
OUT="../ucsbplat-extension-$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])").zip"

FILES=(
  manifest.json
  background.js
  config.js
  injected.js
  popup.html
  popup.js
  popup.css
  icons
)

rm -f "$OUT"
zip -r -q "$OUT" "${FILES[@]}"

echo "packaged $OUT ($(du -h "$OUT" | cut -f1))"
unzip -Z1 "$OUT" | sed 's/^/  /'

# A guard, not a formality: if this ever fires, something that should not ship is in the
# archive, and the whole point of the file was to stop exactly that.
if unzip -Z1 "$OUT" | grep -qE 'sample-data|\.env|README|\.git'; then
  echo "REFUSING: archive contains files that must not ship" >&2
  rm -f "$OUT"
  exit 1
fi
echo "clean: no sample data, no docs, no git metadata"
