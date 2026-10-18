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
SOURCE="$PWD"
STAGING=""
trap 'if [[ -n "$STAGING" ]]; then rm -rf "$STAGING"; fi' EXIT

FILES=(
  manifest.json
  background.js
  config.js
  injected.js
  popup.html
  popup.js
  popup.css
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

case "${1:-}" in
  --release)
    # Prepare hosted settings in an allowlisted copy, preserving the local checkout.
    STAGING="$(mktemp -d)"
    mkdir "$STAGING/icons"
    for file in "${FILES[@]}"; do cp "$file" "$STAGING/$file"; done
    python3 - "$STAGING" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
manifest_path = root / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['host_permissions'] = [host for host in manifest['host_permissions']
                                if host != 'http://localhost:12345/*']
manifest['externally_connectable']['matches'] = [host for host in manifest['externally_connectable']['matches']
                                                 if host != 'http://localhost:12345/*']
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
config_path = root / 'config.js'
config = config_path.read_text()
config_path.write_text(config.replace('export const UCSBPLAT_ORIGIN = LOCAL_ORIGIN;',
                                    'export const UCSBPLAT_ORIGIN = HOSTED_ORIGIN;'))
PY
    cd "$STAGING"
    ;;
  "") ;;
  *) echo "Usage: ./package.sh [--release]" >&2; exit 1 ;;
esac
OUT="$SOURCE/../ucsbplat-extension-$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])").zip"

# Local pages may talk to an unpacked development build, but the published extension
# should never expose its command surface to whatever happens to be running on a user's
# localhost. Keep this as a packaging failure instead of relying on a release checklist.
if grep -q 'http://localhost' manifest.json ||
   grep -q '^export const UCSBPLAT_ORIGIN = LOCAL_ORIGIN;' config.js; then
  echo "REFUSING: extension is still configured for local development" >&2
  exit 1
fi

python3 - <<'PY'
import json
import pathlib
import re

manifest = json.loads(pathlib.Path('manifest.json').read_text())
config = pathlib.Path('config.js').read_text()
assert manifest['manifest_version'] == 3, 'Release must use Manifest V3'
assert set(manifest['permissions']) == {'scripting', 'storage'}, 'Review changed permissions before release'
assert set(manifest['host_permissions']) == {'https://my.sa.ucsb.edu/gold/*', 'https://ucsbplat.com/*'}, 'Unexpected release hosts'
assert manifest['externally_connectable']['matches'] == ['https://ucsbplat.com/*'], 'Unexpected website origins'
assert re.search(r'^export const UCSBPLAT_ORIGIN = HOSTED_ORIGIN;$', config, re.M), 'Release must use HOSTED_ORIGIN'
assert re.search(r'^export const HOSTED_ORIGIN = "https://ucsbplat.com";$', config, re.M), 'Unexpected hosted origin'
PY

rm -f "$OUT"
zip -X -q "$OUT" "${FILES[@]}"

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
