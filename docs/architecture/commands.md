# Command system

### Command System (`renderer/src/lib/commands/`)

The composer parses input into typed `ComposerAction` discriminated unions:
- `!text` → bash command
- `/command [args]` → slash command (builtins mirror pi's TUI: model, compact, name, session, new, export, fork, clone, resume, copy, quit, settings, diff, tree, login, reload)
- Otherwise → user prompt

Builtins are defined in `builtins.ts` (mirrors pi's interactive-mode.js). Discovered commands (extensions/prompts/skills) come from `get_commands` RPC. `parse.ts` resolves input to an action; `execute.ts` dispatches it.

**`/login`** dispatches `{ kind: "open-login" }` → the composer fires a `pivis:open-login` CustomEvent → `App.tsx` opens Settings scrolled to the Account section.

**`/scoped-models`** opens the `ScopedModelsPicker` (a multi-select checkbox list mirroring pi's TUI `showModelsSelector`). Two submit actions match pi's TUI: **Apply** (`set_scoped_models`, session-only — lost on `/reload` since a fresh process rebuilds from `settingsManager.getEnabledModels()`), and **Save to settings** (`save_scoped_models`, global — persists to pi's `settings.json` via `settingsManager.setEnabledModels` AND applies to the current session immediately). After either action the renderer re-fetches `get_available_models` (the bridge returns the scoped subset when `scopedModels` is non-empty) so the `/model` dropdown reflects the new scope live. Footer also has **Select all** / **Select none** bulk toggles.
