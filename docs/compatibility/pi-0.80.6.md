# Pi 0.80.3 → 0.80.6 compatibility audit

Audited against upstream `v0.80.3` through `v0.80.6` on 2026-07-09. Pi-Vis requires the installed pi public SDK surfaces used by the SDK host; an incompatible runtime fails activation rather than switching to another session transport.

## Integration-significant handling

| Upstream change | Pi-Vis handling |
|---|---|
| `agent_settled` | Preserved as a transcript event. Runtime liveness comes from direct `AgentSession` snapshots, not settlement/event inference. |
| `entry_appended` / `registerEntryRenderer()` | The SDK host renders the public component to ANSI; custom entries remain ordered transcript blocks. |
| `showCacheMissNotices` | The host derives and replays non-persisted notices against the active runtime/history. |
| Optional session name metadata | `session_info_changed.name` remains optional and can clear renderer state. |
| `ThinkingLevel.max` | Typed in command, event, settings, and controls; model capability maps remain authoritative. |
| Public model/scope/session exports | Consumed only through public SDK APIs. |
| Project-local resources | Loaded through the deny-by-default trust resolver; reload reinitializes resources in the host transition. |

## Authority compatibility

Pi 0.80.6 supplies the public getters/methods the host snapshots directly: streaming/idle/compaction/retry/bash state, model/session metadata, pending queues, prompt preflight, queue clearing, navigation, and abort primitives. Pi-Vis validates those capabilities at host initialization. Snapshot identity, epoch, sequence, and leases protect renderer state across reload/rebind; submission dispositions, custody, editor revisions, and acknowledged queue restoration are Pi-Vis protocol features around those public APIs.

## Regression gates

Run `npm run typecheck && npm test`, or `npm run test:full`. Targeted authority coverage is in `resources/pi-session-host/state-authority.test.mjs`, `src/main/sessions/session-registry.test.ts`, and `src/renderer/src/stores/sessions-store.test.ts`.
