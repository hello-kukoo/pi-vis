# Pi 0.84.2 compatibility audit

Audited against the upstream coding-agent changelog, published declarations,
and runtime shipped in `@earendil-works/pi-coding-agent@0.84.2` on 2026-08-20.
This audit renews the previous 0.84.1 pin and records every change that crosses
the Pi-Vis SDK-host, persistence, provider, terminal, or release boundary.
Production Pi-Vis bundles and runs that exact package through
`src/main/pi/pinned-pi.ts`; it never discovers or runs a user-installed Pi.
Changing the pin remains a Pi-Vis release decision and requires a new audit.

## Release boundary

- Coding-agent, `pi-agent-core`, `pi-ai`, `pi-client`, `pi-protocol`,
  `pi-telemetry`, and `pi-tui` are installed and source-gated at exactly
  `0.84.2`. TypeBox remains `1.3.7`, Undici remains `8.9.0`, and Pi's Node
  requirement remains `>=22.19.0`. Pi-ai uses OpenAI `6.40.0` and no longer
  depends on the generated Mistral SDK or its Zod runtime.
- The coding-agent root runtime export names, the public session/service entry
  points used by Pi-Vis, the coding-agent `SessionManager` entry declarations,
  and public `TuiMainScreen` surface have no removal or rename at this boundary.
  The additions below are source-compatible with the existing SDK-direct host.
- Pi-Vis does not adopt the experimental client/protocol/agent-core harness.
  There is no `pi --mode rpc`, `PiClient`, v4 lane-session migration, or
  JSON/RPC session fallback. Coding-agent JSONL remains the persistence format.
- The installed-tree gate checks all seven coordinated packages. Electron
  Builder prunes packages outside the imported production graph, so the final
  app gate separately requires the packaged runtime closure: coding-agent,
  `pi-agent-core`, `pi-ai`, and `pi-tui`, all exactly `0.84.2`.

## Required compatibility handling

| Upstream change | Pi-Vis handling |
|---|---|
| Configurable `defaultTools` and `SettingsManager.getDefaultTools()` | The host intentionally omits an explicit built-in tool list when it calls `createAgentSessionFromServices()`, so Pi applies global/project defaults. Pi's public composition still adds trusted extension and SDK custom tools; selecting built-in defaults must not drop them. A real provider request gates both the selected built-ins and a custom extension tool. |
| Extension `sendUserMessage(..., { expandPromptTemplates })` | Pi-Vis passes the public extension API through unchanged. An exact-runtime extension journey dispatches with `expandPromptTemplates: true` and verifies Pi resolves and invokes the target command; Pi-Vis does not reproduce Pi's command, skill, or prompt-template parser. |
| `sendMessage(..., { triggerTurn: false })` records without steering | Pi-Vis retains upstream's corrected no-turn behavior. The exact-runtime patch additionally defers a message created while streaming until the agent settles, so recording it cannot split an assistant tool call from its tool results. Deferred messages are dropped rather than corrupting an active transcript during hard disposal. |
| `AssistantMessage.endTurn`, `ToolCall.namespace`, and model compatibility `supportsAdditionalTools` | These optional fields remain owned by pi-ai. Pi-Vis's passthrough live-event and persisted-message schemas preserve them, including attach checkpoint materialization and JSONL hydration. `endTurn` is diagnostic provider state, not a second Pi-Vis settlement signal; tool namespaces and additional-tool capability are not reconstructed locally. |
| JSON/RPC `message_update.usage` | The stdout JSON/RPC event remains delta-only for assistant content in the 0.84 line, but now includes cumulative `usage` on every update. This does not change direct `AgentSession.subscribe()` events: they still carry cumulative `message` and assistant `partial` snapshots. The host continues consuming the direct type, materializing cumulative content only at attach, and publishing its own linear typed event rather than masquerading as `JsonAgentSessionEvent`. |
| Optional theme roles `searchMatchText` and `searchMatchBg` | Pi's public `Theme` falls back to required `text` and `selectedBg`. The Pi-Vis theme bridge relies on those fallbacks and adds no host↔renderer ANSI role indices. The exact-runtime theme gate verifies both fallback values. Existing `scrollbarThumb` fallback remains unchanged. |
| Generic `AI_AGENT=pi` versus Pi-specific `PI_CODING_AGENT=true` | An SDK import does not run the CLI bootstrap, so the host explicitly establishes both markers before runtime imports. Built-in Bash, extensions, and direct Shell Turns inherit generic agent attribution and the Pi-specific compatibility marker. |
| Native Mistral Chat Completions transport | Pi-Vis delegates auth, request assembly, streaming, retries, and response conversion to pi-ai and does not retain a Mistral SDK adapter. The published native parser receives the exact-runtime patch described below for indexed continuation chunks; provider-facing tests cover the patched behavior without exposing auth over IPC. |
| Strict built-in tool schemas under `PI_EXPERIMENTAL=1` | The pinned runtime owns strict JSON-schema generation for `read`, `bash`, `edit`, and `write`. Pi-Vis neither clones those schemas nor treats the experimental environment flag as a GUI contract. Public declarations for the schema helpers remain gated. |
| `createGatewayBindingFetch()` and Cloudflare Workers AI bindings | This is inherited pi-ai provider transport. The Electron SDK host does not manufacture a Workers binding or token and requires no IPC change. |
| OpenAI Responses deferred `additional_tools` preference and namespace preservation | The public runtime chooses message-anchored additional tools where supported and retains its search/top-level fallbacks. Pi-Vis passes model/tool objects through, so namespaces and capability metadata survive without a duplicate provider table. |
| `exportToHtml(..., { themeName })` | The optional argument is source-compatible. Existing Pi-Vis export calls remain valid; choosing a CLI theme for app HTML export would be a separate product decision. |

The public fixes for model-selector startup refresh, managed-tool progress,
GitHub Copilot policy-update concurrency, Kimi user-agent handling,
request-buffer retries, DeepSeek and Bedrock request normalization, Google
tool-stop classification, custom-system-prompt joining, and provider-specific
output fields are inherited through Pi's runtime. Pi-Vis does not fork provider
capability or retry tables.

The upstream fallback renderer for long extension tool results is an
`InteractiveMode` presentation fix; Pi-Vis renders the typed tool-result
content in its own transcript and does not call that fallback. Subagent example
frontmatter/config propagation changes are documentation/example code, not a
runtime integration. The updated transitive `nanoid` is development-only in
Pi's published graph and is not part of the packaged Pi runtime closure;
Pi-Vis's own lockfile remains subject to its normal dependency review.

### Direct streaming boundary

There are two intentionally different public event contracts:

- `AgentSessionEvent`, used by Pi-Vis, retains cumulative assistant snapshots.
- `JsonAgentSessionEvent`, used by Pi's JSON/RPC stdout modes, carries content
  deltas plus cumulative `usage` on `message_update`.

`resources/pi-session-host/state-authority.mjs` consumes the first contract and
publishes neither public type verbatim. Its checkpoint materializes one
cumulative assistant message only for an attach read barrier; renderer traffic
remains linear. Checked-in cumulative captures therefore remain valid
direct-SDK fixtures and are not examples of the JSON/RPC wire format.

No direct `AgentSessionEvent` discriminant was added or removed. Existing typed
handling of retry, compaction, Bash, message, tool, queue, and settlement
lifecycle remains complete. The optional `endTurn` and tool `namespace` values
are message content, not new lifecycle discriminants.

## New features and non-adoptions

| Feature | Pi-Vis handling |
|---|---|
| Fullscreen transcript search, match navigation, single-line scrolling, lower-allocation repaint, and configurable exit output | These belong to Pi's `InteractiveMode` and `TuiAltScreen`. Pi-Vis does not instantiate either, so it adds no parallel React search/scroll/exit behavior in this pin renewal. Embedded extension panels stay on the unchanged public `TuiMainScreen` and its content-hugging ANSI replay contract. |
| `--use-theme <name[/name]>` | This is a per-run CLI interactive option. Pi-Vis continues using its semantic app theme plus the public host `Theme`; it neither invokes nor mirrors the flag. |
| Search match theme colors | The public fallback behavior is adopted for host TUI surfaces, but fullscreen match highlighting itself is not. No new Pi-Vis theme token or serialized role is introduced. |
| Fullscreen selection, clipboard, overlay scrolling, Escape timeout, Mermaid, and LaTeX fixes | These remain terminal-mode behavior. React transcript diagram/math support and a configurable terminal Escape timeout would be separate product, security, and input-ownership decisions. |

Previously adopted features remain in force: scoped-model resolution,
zero-message model/thinking restoration, provider-owned auth and catalogs,
constrained tool sampling, extension Markdown transformers,
`AGENTS.override.md`, terminating blocked tool calls, deferred responses,
secret-free `pi auth check`, public Pi-TUI panels, and direct Shell Turns.

## Exact private llama.cpp exception

Upstream still ships the llama.cpp manager as the sole hidden entry in
`dist/extensions/index.js`, still absent from the public root export. The
aggregate registry entry remains exactly
`{ name: "llama.cpp", factory, hidden: true }`; the executable factory subtree
is unchanged from the preceding audit apart from source maps.
[ADR 0006](../decisions/0006-pinned-llama-private-extension-exception.md)
therefore renews the same one-version adapter:

1. derive the shipped aggregate registry from the already validated public
   coding-agent entry;
2. require exact Pi version `0.84.2` and the exact one-entry hidden shape;
3. copy only public `InlineExtension` fields; and
4. inject the factory through public
   `resourceLoaderOptions.extensionFactories`.

All behavior after that selection—including `/llama`, auth,
load/unload/download, generation-safe catalog publication, native provider
registration, and the custom Pi-TUI panel—remains public-runtime work. A shape
or version failure disables only local llama management and emits a fixed
capability diagnostic. No other private import is authorized.

## Exact-runtime defect patches

The published package has three release-relevant defects that are not safe to
defer merely because provider or filesystem timing makes them uncommon:

- [#8166](https://github.com/earendil-works/pi/issues/8166): a custom message
  recorded by an extension during a tool batch can split the provider-required
  assistant-tool adjacency and poison later requests.
- [#8345](https://github.com/earendil-works/pi/issues/8345): an unterminated
  valid or invalid JSONL tail can fuse with the next `SessionManager` append and
  break cold restoration or the active parent chain.
- [#8387](https://github.com/earendil-works/pi/issues/8387): the native Mistral
  stream can split one indexed tool call when continuation chunks omit its ID,
  producing a truncated call plus a spurious empty call.

`scripts/patch-pinned-pi.mjs` applies only those fixes to exact published
0.84.2 files. It verifies the package version and known pre-patch SHA-256 before
editing, then requires exact post-patch SHA-256. `postinstall` applies it,
`prebuild` verifies it again without mutation, focused behavioral tests cover
all three defects, and the packaged-app verifier checks the patched hashes in
the final bundle. Unknown bytes or a later package version fail closed. This is
a bounded release patch, not permission for additional private imports or a
generic patch framework; remove each hunk after an audited pin contains the
upstream fix.

## Continuing SDK-host contracts

Direct Shell Turns still emit public `user_bash` exactly once. Handler-supplied
full results are recorded without spawning, replacement `BashOperations` use a
non-PTY turn, and only an unhandled event uses the host PTY. `!` keeps Pi's
canonical command/result eligible for context; `!!` excludes the complete
canonical Bash message. The event still has no preparation `AbortSignal`, so
Pi-Vis retains its pre-controller cancellation fence.

`modelRuntimeSignal` bounds `ModelRuntime.create()` only. The services layer may
perform an additional post-extension non-network refresh without retaining that
signal, so Pi-Vis does not claim the creation timeout bounds every provider
refresh. Explicit refresh intents have their own timeout; provider work that
ignores a public signal remains an upstream limitation.

The host's public 0.80.6–0.80.7 `ModelRegistry` compatibility adapter remains
unit-testable but is unreachable in production under the exact current pin.

The release boundary also includes Pi-Vis's credential/manual-code response
seam. Main strict-parses the renderer's `ExtensionUiResponse` before registry
routing: variants reject unknown keys, `id` and optional `operationId` are each
limited to 128 UTF-8 bytes, and text `value` is limited to 64 KiB. Focused
multibyte and unknown-key tests gate those byte limits; the independently
required owner, generation, host, epoch, operation, and pending-request fences
still apply after parsing. No credential response is stored in renderer state,
an authority frame, a replay baseline, or a log.

## Release gates

- `npm ci` must recreate the exact lockfile graph and run the fail-closed Pi and
  node-pty postinstall patches. The declaration/runtime gate then checks all
  seven coordinated Pi packages, Node, TypeBox, Undici, public exports and
  declarations, direct-versus-JSON events, CLI auth forms, and new optional
  message/tool/model fields.
- `npm run test:full` is mandatory and includes typecheck, lint, unit, build,
  render, and Electron E2E. The real-SDK lane uses the repository-local exact
  CLI, isolated state, and loopback providers to cover default tools plus custom
  tools, prompt expansion, environment-marker parity, streaming/checkpoints,
  persistence, providers, extensions, Shell Turns, compaction/races,
  replacement, project trust, and llama management.
- `npm run dist` is mandatory on the release platform. The final-artifact
  verifier checks the four-package production runtime closure, executable
  version, exact private llama registry, pinned-Pi patch hashes, native PTY from
  both resolution paths, and a packaged Electron session. It also persists an
  existing `piBinaryPath` and proves the packaged app ignores it without the
  explicit test activation marker.
- `npm run release` runs the complete automated check list, including a
  zero-advisory production `npm audit`, and has no supported test-skip path.
  Public publication still additionally requires the manual
  provider-backed Kitty/input journey, the manual GUI/IME/dead-key smoke, and
  successful signing, Gatekeeper, notarization, and stapling documented in
  `RELEASING.md`.

The private llama adapter, exact-runtime patch, source graph, and packaged graph
are independent gates: success in one is not evidence for another. A release is
not ready if any required command, final-artifact check, or manual publication
gate remains unverified.

## References

- [Upstream Pi 0.84.2 coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/CHANGELOG.md)
- [Pinned llama.cpp private-extension exception](../decisions/0006-pinned-llama-private-extension-exception.md)
- [Runtime services](../architecture/runtime-services.md)
- [Testing](../testing.md)
