# Architecture decision records

Use this directory for durable architectural decisions that should outlive a single implementation change.

## Format

Create files named `NNNN-short-title.md`:

```md
# NNNN: Short title

## Status

Accepted | Proposed | Superseded

## Context

What problem or constraint forced this decision?

## Decision

What are we choosing?

## Consequences

What trade-offs, follow-up work, or invariants does this create?

## References

- Related files/docs/tests
```

Link new ADRs from the relevant `docs/architecture/*.md` file and from `docs/agent-index.md` when agents should read them for future work.
