# Pi 0.80.3 → 0.80.6 compatibility audit

Audited against upstream tags `v0.80.3` (`a23abe4a`) through `v0.80.6` (`2b3fda99`) on 2026-07-09. Pi's package version is **0.80.6** (the user-facing shorthand “0.8.6” is not the npm semver). `0.80.4` was tagged but not published; `0.80.5` carries the same runtime changes.

Official comparisons:

- <https://github.com/earendil-works/pi/compare/v0.80.3...v0.80.4>
- <https://github.com/earendil-works/pi/compare/v0.80.4...v0.80.5>
- <https://github.com/earendil-works/pi/compare/v0.80.5...v0.80.6>

## Integration-significant changes and disposition

| Upstream change | Pi-Vis handling |
|---|---|
| `agent_settled`; `agent_end` is no longer a terminal session boundary | Typed as a known event. SDK host, RPC adapter, registry, and renderer use generation-guarded settlement plus normalized `streaming_state`/`interrupt_state`; stale settlement cannot clear a newer extension-started run. |
| `entry_appended` and `registerEntryRenderer()` | Typed and reduced into `custom_entry` transcript blocks in persisted order. The SDK-host-only `render_entry` command invokes the public renderer at the measured configured-code-font width and returns ANSI. Runtime replacement re-renders entries; missing/failed renderer and RPC fallback hide them without stale output. |
| `showCacheMissNotices` | The SDK host re-derives significant misses after successful assistant `message_end` events and through `get_cache_miss_notices` after history hydration/pagination. Deterministic ids deduplicate live/replayed cards and history anchors preserve order. |
| Session metadata event may clear a name | `session_info_changed.name` is optional; omitted names clear renderer state instead of being downgraded to an unknown event. |
| Session header `metadata` | Existing header schema uses `.passthrough()`, so metadata survives validation without a format migration. Session format remains v3. |
| Short IDs changed from UUIDv7 prefix to random tail | IDs were already treated as opaque strings. |
| `ThinkingLevel` adds `max` | Added to command/event/settings schemas, persisted preferences, preview host, and controls. Model `thinkingLevelMap` is preserved; explicit nulls are filtered and `xhigh`/`max` are opt-in. Scoped-model patterns strip `:max`. |
| Theme adds optional `thinkingMax` | Explicit semantic role supplied. It is appended to the ANSI role table so old role indices remain stable. |
| Model cost adds request-wide input tiers | Model schemas are passthrough and session stats consume Pi's authoritative computed `cost`; no local repricing exists to become stale. |
| `before_provider_headers`, named `InlineExtension`, context-entry transforms, provider/model hooks | Loaded and executed inside Pi's public `createAgentSessionServices`/`bindExtensions` runtime. Pi-Vis does not reinterpret these APIs. |
| Project-local package config (`pi config -l`) | Resource discovery/reload remains delegated to Pi services under the existing deny-by-default trust resolver. `/reload` respawns and therefore reloads project/global resources, themes, and context files. |
| Public model/scope resolver exports and session storage exports | Additive SDK APIs; no consumer change required. Pi-Vis continues to use public surfaces only. |
| `/login <provider>`, model catalog changes, retry/provider/compaction fixes, `shellPath` `~` expansion | Owned by the installed Pi runtime/CLI and inherited automatically. Provider/model lists come from `modelRegistry`; no catalog snapshot is embedded. |

## Explicit non-changes

- Node requirement remains `>=22.19.0`; Electron 43's Node 24 satisfies it, and the dynamic host exec-path policy remains valid.
- No RPC command or response was removed or renamed.
- No pi-tui public API or keyboard protocol changed in this range.
- No session schema version bump or migration is required.
- `0.80.4` and `0.80.5` runtime code is identical for the packages Pi-Vis integrates.

## Regression gates

See `docs/testing.md` for the targeted protocol, host, reducer/history, theme, control, render, and existing `agent_settled` tests. The mandatory full suite remains the release gate.
