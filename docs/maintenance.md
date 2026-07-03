# Documentation maintenance

Project documentation is split by purpose:

- `AGENTS.md` contains only mandatory agent workflow and hard project rules.
- `docs/agent-index.md` routes agents to the smallest relevant context set.
- `docs/architecture/*.md` contains architecture and subsystem notes.
- `docs/decisions/*.md` contains ADRs for durable decisions.

## Keep docs in sync

Update the relevant docs in the same change whenever you alter:

- project structure: new directories, moved/deleted files, renamed modules
- architecture: new processes, changed data flow, new IPC channels/events
- state management: new stores, changed store shape, reducer invariants
- protocols: new pi RPC commands, changed event schemas, extension UI methods
- tooling: npm scripts, test framework/config, build/release flow
- UI conventions: CSS approach, key interactions, theming, external dependencies

## Routing rules

- If a new subsystem or doc is added, update `docs/agent-index.md` so future agents know when to read it.
- Do not add long architecture explanations to `AGENTS.md`; add them to the relevant architecture doc or an ADR.
- If a doc becomes stale, fix the doc in the same change as the code.
