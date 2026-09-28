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

# Local pages may talk to an unpacked development build, but the published extension
# should never expose its command surface to whatever happens to be running on a user's
# localhost. Keep this as a packaging failure instead of relying on a release checklist.
if grep -q 'http://localhost' manifest.json ||
   grep -q '^export const UCSBPLAT_ORIGIN = LOCAL_ORIGIN;' config.js; then
  echo "REFUSING: extension is still configured for local development" >&2
  exit 1
fi

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
