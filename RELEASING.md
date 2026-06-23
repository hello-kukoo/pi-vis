# Releasing Pi-Vis

## macOS Build & Distribution

### Required environment variables

For a signed and notarized macOS build (distribution to other Macs):

| Variable | Description |
|---|---|
| `APPLE_ID` | Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (generate at appleid.apple.com, *not* your iCloud password) |
| `APPLE_TEAM_ID` | Team ID from [Apple Developer](https://developer.apple.com/account) (e.g. `ABCDEF1234`) |
| `CSC_LINK` | (optional) Path or base64-encoded signing certificate; auto-resolved by electron-builder when a valid Developer ID cert is in the keychain |
| `CSC_KEY_PASSWORD` | (optional) Password for the signing certificate |

If `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are all set, the `afterSign` hook in `build/notarize.cjs` will submit the `.app` for notarization after signing. Without them, the build proceeds unsigned with a logged skip message — `npm run dist` works locally without any credentials.

### Build commands

```bash
# Unsigned local development build (dmg + zip, arm64)
npm run dist

# Signed & notarized release build
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDEF1234"
npm run dist
```

### Architecture

Builds target **arm64 (Apple Silicon) only**. Apple Silicon is the assumed
audience; an arm64 app does **not** run on Intel Macs (Rosetta only translates
x64→arm64, not the reverse). To support Intel later, add `x64` (or a `universal`
target) under `mac.target` in `electron-builder.yml` — note that `node-pty` ships
no macOS prebuilts, so the x64 slice must be built from source on/for an x64
toolchain (e.g. a per-arch CI job).

### Publishing a GitHub release

The README install command (`curl … | bash` → `scripts/install.sh`) pulls the
latest GitHub release's `*-mac.zip` asset. To cut a release so that command
works:

```bash
# 1. Build the artifacts (signed+notarized if Apple env vars are set, ad-hoc otherwise)
npm run dist

# 2. Publish a release tagged vX.Y.Z and upload the dmg + zip
VERSION=$(node -p "require('./package.json').version")
gh release create "v${VERSION}" \
  "release/${VERSION}/Pi-Vis-${VERSION}-arm64-mac.zip" \
  "release/${VERSION}/Pi-Vis-${VERSION}-arm64.dmg" \
  --title "v${VERSION}" \
  --notes "Pi-Vis v${VERSION}"
```

`install.sh` resolves the asset via the GitHub API (`releases/latest`), so it
keeps working across versions with no edits — it just needs each release to
carry a `*-mac.zip` asset. The `.zip` (not the `.dmg`) is what the installer
unpacks into `/Applications`.

**Quarantine note:** the installer downloads over `curl`, so macOS does not
apply `com.apple.quarantine` and Gatekeeper does not block the ad-hoc-signed
app. This is the temporary stand-in for notarization; once notarization works,
the same release flow continues to apply (notarized builds also install
cleanly).

### CI

See `.github/workflows/ci.yml` for the current CI pipeline (typecheck → lint → test → build on push/PR). Notarization credentials should be stored as repository secrets and injected in a release workflow.