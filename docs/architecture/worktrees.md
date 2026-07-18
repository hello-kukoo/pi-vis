# Worktree-per-session

### Worktree-per-session

A **WorktreeBar** above the composer appears in brand-new sessions (empty transcript).
A session remains empty until its first user message is sent; Pi may create and report the
JSONL file during startup, so `sessionFile` alone does not establish the session. It is a
3-way **segmented control**: `[In Workspace] [New Worktree] [Existing Worktree]`. The segment
selection drives which controls appear below it:

- **Workspace** (`worktreeMode = "none"`, default): run the session in the
  workspace cwd, no worktree.
- **New** (`worktreeMode = "create"`): show the shared `BranchDropdown` for the
  base branch. On first send, `session.createWorktree` IPC creates a git
  worktree in a sibling `<repoName>-worktrees/<friendlyName>` directory on a
  fresh `pi-vis-<friendlyName>` branch (e.g. `pi-vis-swift-otter`), cutting
  from the selected base branch.
- **Existing** (`worktreeMode = "attach"`): show a path **text input** plus a
  **"Browse…"** button (native directory picker via `worktree.pickDirectory`,
  defaulting to the repo's sibling `<repoName>-worktrees` dir when it exists).
  A debounced (~300ms) live validation line (`worktree.validate` → advisory
  branch confirmation or semantic inline error) gives fast feedback while the
  authoritative validation gate is the `session.attachWorktree` IPC re-running
  `inspectWorktree` server-side (so a stale/edited live result can never
  persist a bad path). On first send, `session.attachWorktree` IPC attaches
  the chosen worktree; the renderer uses the **same** success/failure
  handling as the create flow (`applyWorktree`, `clearWorktreeIntent`,
  toast `Attached worktree <name>`).

Both New and Existing converge on the same plumbing:

1. `setWorktreeAndRespawn()` re-points the session's `cwd` to the worktree and
   re-spawns the pi process there.
2. The WorktreeBar vanishes; the title bar shows **WorktreeSwitcher** at the
   former chip position. Its branch-icon trigger reads the friendly worktree
   name, or **Workspace** for an established session still in the root checkout.
   The popup keeps path copying explicit and shows the current branch, created
   base (when distinct), and canonical path. The fresh-session bar can create
   from its selected base; the established-session popup can create or attach a
   browsed/pasted existing worktree. Its create flow intentionally has no base
   picker: renderer sends `fromCurrentCheckout`, and
   main resolves the exact `HEAD` of the session's current checkout while still
   placing the new worktree beside the owning workspace. The user chooses
   whether to copy the source checkout's staged patch, unstaged patch,
   intent-to-add entries, and non-ignored untracked files into the new worktree
   without mutating the source; the checked default preserves the existing
   copy behavior, while clearing it creates a clean checkout. Ignored files
   always remain local. Fixing the base to the exact source commit makes that transfer
   deterministic instead of attempting to apply it to an arbitrary, potentially
   divergent branch. Immediately before detaching the host, main rechecks the
   source. When copy is enabled it captures the source a second time and
   compares its HEAD, branch label, patches, modes,
   symlinks, intent-to-add paths, and untracked payload digest with the original
   snapshot. Capture first resolves the canonical Git toplevel and runs every
   path-producing command from that coordinate system, so configured nested
   workspaces include correctly located intent-to-add and all repository
   untracked state. Each capture then regenerates staged/unstaged patches,
   path lists, status, HEAD/branch, and a direct second source-vs-capture payload
   hash after copying; an internally mixed capture is rejected. The retained
   tree is hashed before that second source observation. A before/after
   metadata fingerprint covers every dirty tracked/untracked/intent payload and
   semantic index entries (including explicit missing markers for deletions),
   then only cheap metadata/ref checks finish the guard, avoiding a long
   temp-only blind interval. Modes for wholly untracked parent directories are
   captured and restored after payload copying, including restrictive parents.
   Any intervening checkout change aborts and removes the destination. When
   copy is disabled, main reads and rechecks only the source HEAD and branch
   label, so uncommitted payload is neither copied nor needlessly captured.
   Applying either choice moves the same session to that worktree; its
   conversation and draft recovery state are preserved. Apply is available only
   for a ready, available, authoritatively idle runtime; main repeats that
   eligibility check before git work and again at the respawn boundary. Failures
   remain inline so the popup is retryable. A session does not need an existing
   worktree to reach this flow: brand-new Workspace sessions use WorktreeBar,
   and established Workspace sessions use the title-bar switcher with **New
   worktree** selected by default.
3. `settings.worktrees` is persisted **keyed by the canonical worktree toplevel**
   (`git rev-parse --show-toplevel` + `fs.realpath`), not the raw user input.
4. A successful move of an established session also writes
   `settings.sessionWorktrees[resolve(sessionFile)] = canonicalWorktreePath`.
   Returning from a linked worktree to the owning Workspace writes the canonical
   workspace cwd as an explicit override after the authoritative respawn while
   retaining shared worktree associations. This sentinel is required when the
   immutable header originally names a worktree. Pi owns the JSONL and its original header `cwd` is immutable, so discovery
   must prefer this explicit per-file override. An invalid/stale override falls
   back to Workspace rather than resurrecting the old header location. Cold-open
   overrides are revalidated as canonical Git checkouts with the same common
   directory as Workspace; a plain directory or unrelated repository that
   reuses the saved path is never used as a session cwd. Cold activation repeats
   that validation immediately before spawn, falls back to Workspace (and
   persists the sentinel best-effort) if the path changed, and refreshes branch
   identity if the same checkout moved branches. Session ownership filtering uses the same effective cwd on fresh scans and cache
   hits, keeping moved sessions under the correct parent workspace after
   relaunch. For a live record, `session.open` prefers the registry's current
   checkout over persisted discovery, and successful replacement emits
   `session.worktreeChanged`. A renderer reloaded during a slow switch therefore
   adopts the final host location even though the initiating IPC response
   belonged to the destroyed renderer. The same event closes any diff viewer
   bound to that session's previous Git root; the shortcut is also fenced while
   a renderer-initiated switch is pending. Shared operation and diff-store
   guards reject switching when an edit/comment draft already has custody and
   prevent opening the viewer or beginning new drafts once switching starts.
   The switcher cannot be dismissed while main owns an operation. Failure text,
   including a recoverable checkout path, survives close/reopen and is also
   retained in main for renderer-reload recovery until the next attempt.
   Every failed close-preparation/confirmation path that releases close custody
   restores an attached runtime left transitioning by an aborted switch.
   Main publishes operation custody and returns it from `session.open`, so a
   renderer reload cannot temporarily drop the fence; completion publishes an
   authoritative inactive transition. Checkout identity carries a monotonic
   main-process revision. A reconstructed renderer follows `session.open` with
   an authoritative snapshot query, recovering events dropped before its store
   existed and rejecting any older response/event that arrives afterward.

**Validation strategy** (`inspectWorktree` in `git/git.ts`): a two-part
check that guards against attaching to an unrelated repo. **Canonicalization
is the load-bearing part** — a fresh-context review found that skipping it
breaks subdir inputs, relaunch re-attach, and the workspace-self guard, all
at once. Order of checks (cheapest first, with crisp messages):

1. `fs.stat(input)` → missing/not-a-dir → "Directory not found." (Done
   *before* shelling out to git: `mapSpawnError` maps ENOENT to
   `git-missing` — wrong message.)
2. `git rev-parse --show-toplevel` fails → "Not a git repository."
3. Canonicalize the candidate to its worktree root + `fs.realpath`
   (collapses a pasted subdirectory of a worktree down to the worktree
   root, and resolves macOS `/var`↔`/private/var` symlinks). Every
   downstream use — the same-repo compare, the persisted
   `settings.worktrees` key, the respawn cwd, and the chip name — uses
   this canonical toplevel, never the raw input.
4. Same-repo proof via `git rev-parse --git-common-dir`: resolve both
   sides' common dirs (relative paths resolved against each Git command's
   cwd, then `realpath`'d), and compare for byte equality. Mismatch
   → "That directory belongs to a different repository."
5. Current-checkout guard: compare the candidate with the session's actual
   realpath'd Git toplevel and reject only a no-op target. The result also
   carries the owning workspace's canonical Git toplevel, so a configured
   nested workspace recognizes `/repo` as Workspace but respawns at its original
   `/repo/subdir` cwd. This permits a linked-worktree session to return while
   preventing a pointless restart into its current checkout.
6. Branch label: `git rev-parse --abbrev-ref HEAD`; `HEAD` (detached) →
   `--short HEAD`; falls through to `"(no commits)"` for an unborn HEAD.
   Never fails validation — attaching to an unborn-HEAD worktree is still
   valid.

The attach IPC is the **authoritative** gate: it re-runs `inspectWorktree`
server-side and uses the returned canonical `path`, so a stale/edited live
result can never persist a bad path.

**Reliability & error UX** (`createWorktree` in `git/git.ts`): `git worktree add`
is a full working-tree checkout, so on a large repo it can take minutes —
it runs with a generous `WORKTREE_ADD_TIMEOUT_MS` (10 min) instead of the 15s
default that governs the cheap read-only commands (the short default was
SIGTERM-ing the checkout on big repos and surfacing as a meaningless "code 1").
Creation is serialized by canonical repository (session-level locking alone is
insufficient when two sessions share one repo), then checks out the target
commit detached and creates the generated branch only after checkout succeeds.
A failed or timed-out add removes a registration only when its path and expected
HEAD prove ownership; an unverified path is reported and left untouched. A
branch-attachment failure removes the branch only
when that checkout proves it owns the ref. Before `git worktree add` starts populating the chosen path, main installs a
path reservation and retains it through copy/validation/detachment; attach
validation rejects reserved destinations, and cleanup also verifies no other live registry session
has adopted the path before removal. Failures are captured via `execGitCapture` (a non-throwing exec helper that
returns code + **stderr** + signal + `timedOut`) and turned into an actionable
message by `describeWorktreeAddFailure` (git's own stderr, or an explicit
timeout message). The base ref is pre-flight-validated (`rev-parse --verify
<base>^{commit}`) so a deleted/renamed base reads as a crisp message, not a
verbose git error. The session's in-memory worktree association is committed
only after the respawn succeeds; if the replacement pi process fails to start
or exits immediately, the previous `worktreePath` is restored and any commands
queued behind the restart are rejected rather than hanging. Because checkout
can be slow, the registry first publishes an authoritative transitioning fence
that rejects new editor/submission ingress, requests a host snapshot, finishes
any asynchronous lifecycle preflight, then requests and captures one final host
snapshot. The source-checkout guard runs after that final host request with no
intervening await before detachment. Main rechecks eligibility at that boundary; if it changed
after `git worktree add`, or copying local changes fails, it removes the
freshly-created checkout and branch at that safe pre-detach boundary. It never
force-cleans after replacement startup, when extensions may already have written
user data. If replacement activation fails after that boundary, the registry
best-effort restarts the host in its previous checkout using retained editor
recovery. Main persists the destination as a recoverable association, returns an
inline error naming its exact path and how to reattach it, and emits the
registry's rolled-back location so a renderer that reloaded during provisional
activation cannot retain the failed target. Main also rejects a second create/attach request for the same session
while one is in flight, preventing a queued operation from resolving its base
against a checkout the first operation has already replaced. Persistence is also
committed only after a successful respawn, and its synchronous read-modify-write
merges against the latest `settings.worktrees` and `settings.sessionWorktrees`
maps at that commit point. This is load-bearing when two sessions create,
attach, or switch worktrees concurrently: neither operation may replace the
other's association or per-session override with a stale pre-respawn snapshot,
or the affected session would be filtered from the sidebar or reopen at its old
location after relaunch. If the post-respawn settings write fails, main retries
with fresh settings reads; after persistent failure it still returns the already
switched identity so renderer and host cannot disagree, while surfacing a
warning that relaunch persistence failed. During creation the **composer is frozen** (`worktreeCreating`
forces `live=false`, disabling the textarea) so the in-flight send reads as
"sending", not stuck unsubmitted text. On failure the reason is shown **inline
and durably** in the WorktreeBar (`session.worktreeError` → `.worktree-bar__error`,
selectable, persists until the user retries or edits the inputs), and the
prompt text is preserved for retry — not lost behind an ephemeral toast.

**Responsive reflow**: At narrow widths the secondary controls (model picker,
thinking level, changes badge, context meter) drop into a **SessionSubBar** below the
38px title bar. The name and right-side WorktreeSwitcher stay up top. The `SessionControls` component
is the single source of truth rendered in either position. Mechanism: a
`ResizeObserver` on `.session-header` flips `headerCompact` when the header's
*available* width drops below 560px. Two things make this correct: (1) `.session-header`
has `min-width: 0` so as a `flex: 1` child it clamps to the title bar's available width
instead of ballooning to its content's intrinsic width — without it the un-shrinkable
controls push the header past the viewport and the breakpoint never fires; (2) the model
picker button is width-capped + ellipsized so one long model id can't blow out the
cluster. The 560 threshold sits just above the cluster's realistic max (~540px) so
controls reflow before they'd clip. See [Responsive layout system](#responsive-layout-system).
