# Releasing

## Releasing

See [RELEASING.md](./RELEASING.md) for macOS signing, notarization, and build instructions.
Required env vars (with no defaults): `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
Optional: `CSC_LINK`, `CSC_KEY_PASSWORD`.

End users install via `curl … | bash` → `scripts/install.sh` (README "Install"
section), which downloads the latest release's `*-mac.zip` and unpacks it to
`/Applications`. Cutting a release = `npm run dist` then `gh release create`
with the zip+dmg attached (see RELEASING.md "Publishing a GitHub release"). The
curl path avoids quarantine, so the ad-hoc-signed build launches without a
Gatekeeper prompt even before notarization is set up.

See also [`RELEASING.md`](../RELEASING.md).
