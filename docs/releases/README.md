# Pi-Vis release notes

Keep curated GitHub Release notes here, one file per public release:

```txt
docs/releases/vX.Y.Z.md
```

Preferred format:

```md
## Highlights

- Added …
- Improved …
- Fixed …

## Upgrade notes

- No manual action required.

## Assets

- macOS Apple Silicon ZIP for installer/auto-update
- macOS Apple Silicon DMG for manual install
```

Commit the notes file before running the release command, then pass it to the release command:

```bash
npm run release -- --notes-file docs/releases/vX.Y.Z.md --yes
```

Use `--generate-notes` only when curated notes are not appropriate for a small or emergency release.
