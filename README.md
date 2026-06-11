# Pi-Vis

Electron desktop GUI for the [pi.dev](https://pi.dev) coding agent — multiple parallel sessions, workspace sidebar, Catppuccin Mocha theme.

## Requirements

- Node.js 20+
- pi coding agent CLI installed globally:
  ```
  npm i -g --ignore-scripts @earendil-works/pi-coding-agent
  ```

## Setup

```
npm install
```

## Development

```
npm run dev
```

Opens the Electron app with HMR. The renderer is also accessible at http://localhost:5173 (with a stub pivis API).

## Testing

```
npm test           # unit tests (vitest)
npm run test:e2e   # e2e smoke tests (playwright)
```

## Building

```
npm run build      # typecheck + electron-vite build
npm run dist       # build + electron-builder (mac dmg/zip)
```

## Architecture

- Every session runs `pi --mode rpc` as a subprocess — exact terminal parity, same extensions, same compaction
- RPC protocol: JSONL on stdin/stdout with correlated request IDs
- Extension UI (select/confirm/input/editor dialogs, toasts, status segments, widgets) fully serialized over RPC
- Session files in `~/.pi/agent/sessions/` are enumerated for workspace history; the file's header `cwd` field is used for grouping (not directory-name encoding)
- Settings: `~/Library/Application Support/pi-vis/settings.json` (overrideable via `PIVIS_SETTINGS_DIR` env var for tests)

## Key files

| Path | Purpose |
|------|---------|
| `src/shared/pi-protocol/` | Zod schemas for every RPC command, event, response, extension-ui type |
| `src/shared/ipc-contract.ts` | Typed IPC surface (renderer ↔ main) |
| `src/main/pi/jsonl-stream.ts` | Byte-level JSONL parser (splits only on `\n`, never Unicode separators) |
| `src/main/pi/pi-process.ts` | Single pi subprocess wrapper with correlated RPC |
| `src/main/sessions/session-registry.ts` | SessionId → PiProcess lifecycle, blocks double-open |
| `src/renderer/src/stores/transcript.ts` | Pure reducer: PiEvent → TranscriptBlock[] |
| `tests/fixtures/fake-pi.mjs` | Scripted stand-in for real pi (for e2e tests) |

## Verification checklist

1. `npm run typecheck && npm test` — all green
2. `npm run dev` — app opens, add a workspace, create session, type a prompt
3. Extension parity: install `pi-headroom` extension, start session, trigger large tool output — headroom status/toasts appear in the GUI
4. Resume: create a session in the GUI, quit, reopen — history loads correctly
5. `/login` for API-key provider works via dialog roundtrip
6. `npm run dist` produces a launchable `.dmg`
