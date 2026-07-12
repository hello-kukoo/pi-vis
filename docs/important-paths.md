# Important paths

| Path | Purpose |
|---|---|
| `resources/pi-session-host/host.mjs` | SDK-host subprocess entry; the sole live `AgentSession` authority. |
| `resources/pi-session-host/state-authority.mjs` | Direct snapshots, submission admission/custody, escape, queue restoration, and atomic transitions. |
| `resources/pi-session-host/state-authority.test.mjs` | Fault-injection regression coverage for authority protocol. |
| `resources/pi-session-host/bridge.mjs` | Public SDK command/event bridge and runtime rebind wiring. |
| `src/main/pi/session-host.ts` | Child-IPC wrapper, host envelope identity/sequence validation, and resync fencing. |
| `src/main/sessions/session-registry.ts` | Snapshot lease/availability, process-cap refusal, lifecycle, acknowledgements, and two-phase close. |
| `src/main/ipc.ts` | Typed renderer↔main handler registration and host event forwarding. |
| `src/shared/ipc-contract.ts` | Typed IPC boundary. |
| `src/shared/pi-protocol/runtime-state.ts` | Snapshot, disposition, transition, escape, and runtime-state schemas. |
| `src/renderer/src/stores/sessions-store.ts` | Renderer projection of runtime authority plus presentation state. |
| `src/renderer/src/lib/commands/` | Composer parsing and command/submission dispatch. |
| `src/renderer/src/stores/tree-store.ts` | Conversation tree state and host capability handling. |
| `tests/fixtures/fake-host-process.mjs` | Deterministic SDK-host child-process test harness. |
| `tests/fixtures/fake-pi.mjs` | Version/update test executable; not a session runtime. |
| `~/.pi/agent/sessions/` | Persisted session JSONL history. |
| `~/Library/Application Support/pi-vis/settings.json` | Pi-Vis settings. |
| `tests/e2e/electron-launch.mts` | Electron E2E launcher and cleanup integration. |
| `RELEASING.md` | Packaging, signing, and release instructions. |
