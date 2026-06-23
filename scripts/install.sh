#!/usr/bin/env bash
#
# Pi-Vis installer.
#
# Downloads the latest Pi-Vis release and installs it to /Applications,
# without requiring a build from source. Because the app is downloaded over
# curl (not a browser), macOS never applies the `com.apple.quarantine`
# attribute, so Gatekeeper does not block the ad-hoc-signed app on first
# launch — no "unidentified developer" / "damaged app" prompt.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/rsingapuri/pi-vis/main/scripts/install.sh | bash
#
set -euo pipefail

REPO="rsingapuri/pi-vis"
APP_NAME="Pi-Vis.app"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Preconditions ----------------------------------------------------------

[ "$(uname -s)" = "Darwin" ] || die "Pi-Vis is macOS-only (detected $(uname -s))."

arch="$(uname -m)"
if [ "$arch" != "arm64" ]; then
  die "Pi-Vis ships Apple Silicon (arm64) builds only; detected '$arch'.
An arm64 app does not run on Intel Macs. Build from source instead:
  https://github.com/${REPO}#building"
fi

command -v curl  >/dev/null 2>&1 || die "curl is required."
command -v unzip >/dev/null 2>&1 || die "unzip is required."

# --- Resolve the latest release zip asset -----------------------------------

info "Looking up the latest Pi-Vis release..."
asset_url="$(
  curl -fsSL "$API_URL" \
    | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*-mac\.zip"' \
    | head -n 1 \
    | sed -E 's/.*"(https:[^"]*)"$/\1/'
)"

[ -n "$asset_url" ] || die "Could not find a macOS .zip asset on the latest release.
See https://github.com/${REPO}/releases to install manually."

# --- Choose an install destination ------------------------------------------

dest="/Applications"
if [ ! -w "$dest" ]; then
  if mkdir -p "$HOME/Applications" 2>/dev/null; then
    dest="$HOME/Applications"
    warn "/Applications is not writable; installing to $dest instead."
  else
    die "Cannot write to /Applications or ~/Applications."
  fi
fi

# --- Download and install ---------------------------------------------------

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

info "Downloading $(basename "$asset_url")..."
curl -fSL --progress-bar "$asset_url" -o "$tmp/pi-vis.zip"

info "Unpacking..."
unzip -q "$tmp/pi-vis.zip" -d "$tmp/extracted"

[ -d "$tmp/extracted/$APP_NAME" ] || die "Unexpected archive layout: $APP_NAME not found inside the zip."

if [ -d "$dest/$APP_NAME" ]; then
  info "Removing previous install at $dest/$APP_NAME..."
  rm -rf "$dest/$APP_NAME"
fi

info "Installing to $dest/$APP_NAME..."
mv "$tmp/extracted/$APP_NAME" "$dest/"

# Belt-and-suspenders: strip quarantine in case the file picked it up.
xattr -dr com.apple.quarantine "$dest/$APP_NAME" 2>/dev/null || true

info "Done. Launch Pi-Vis with:"
printf '  open "%s/%s"\n' "$dest" "$APP_NAME"
