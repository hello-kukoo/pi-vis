import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_BOUNDARIES,
  LIFECYCLE_EVENTS,
  LIFECYCLE_OPERATIONS,
  evaluateLifecycleAdmission,
  evaluateLifecycleCut,
} from "./fixtures/lifecycle-boundary-model.mjs";

describe("finite lifecycle boundary model", () => {
  const cases = LIFECYCLE_OPERATIONS.flatMap((operation) =>
    LIFECYCLE_BOUNDARIES.flatMap((boundary) =>
      LIFECYCLE_EVENTS.map((event) => ({ operation, boundary, event })),
    ),
  );

  it(`enumerates all ${cases.length} operation/boundary/lifecycle cuts`, () => {
    expect(cases).toHaveLength(
      LIFECYCLE_OPERATIONS.length * LIFECYCLE_BOUNDARIES.length * LIFECYCLE_EVENTS.length,
    );
  });

  for (const item of cases) {
    it(`${item.operation} @ ${item.boundary} + ${item.event}`, () => {
      const outcome = evaluateLifecycleCut(item.operation, item.boundary, item.event);

      // No predecessor continuation or automatic successor dispatch is valid
      // after detach, replacement, or close freeze.
      expect(outcome.rendererContinuation).toBe(false);
      expect(outcome.successorDispatch).toBe(false);

      // Every intent dispatches at most once. Outcome-unknown work has exactly
      // one review state and is never replayable; terminal work is not also a
      // review. Fenced non-effect continuations are neither misreported as
      // completed nor turned into effectful review.
      expect(outcome.dispatchCount).toBe(outcome.dispatched ? 1 : 0);
      expect(outcome.dispatchCount).toBeLessThanOrEqual(1);
      expect(outcome.replayable && outcome.possibleHostMutation).toBe(false);
      if (outcome.settlement === "outcome_unknown") {
        expect(outcome.reviewRequired).toBe(true);
        expect(outcome.terminal).toBe(false);
        expect(outcome.replayable).toBe(false);
        expect(outcome.outcomeUnknownReplayAllowed).toBe(false);
      }
      if (outcome.terminal) expect(outcome.reviewRequired).toBe(false);
      expect(outcome.composerCleared).toBe(false);

      // A claimed unified action never transfers its claim. An unclaimed one
      // transfers only before child dispatch.
      if (item.operation === "unified-claimed") {
        expect(outcome.claimTransferred).toBe(false);
        expect(outcome.replayable).toBe(false);
      }
      if (item.operation === "unified-unclaimed") {
        expect(outcome.claimTransferred).toBe(
          item.event === "renderer-detach" && !outcome.dispatched,
        );
      }

      expect(outcome.ingressFrozen).toBe(item.event === "close-freeze");
      expect(outcome.successorIdentityRequired).toBe(item.event === "runtime-replacement");
      if (item.event !== "renderer-detach") expect(outcome.replayable).toBe(false);

      // Runtime replacement can never apply a predecessor editor revision.
      if (item.operation === "editor-patch" && item.event === "runtime-replacement") {
        expect(outcome.editorRevisionMayApply).toBe(false);
      }
    });
  }

  it("rejects every unavailable, transitioning, closing, or stale-identity admission", () => {
    for (const available of [false, true]) {
      for (const transitioning of [false, true]) {
        for (const closing of [false, true]) {
          for (const identityMatches of [false, true]) {
            const admission = evaluateLifecycleAdmission({
              available,
              transitioning,
              closing,
              identityMatches,
            });
            const expected = available && !transitioning && !closing && identityMatches;
            expect(admission.admitted).toBe(expected);
            expect(admission.dispatchCount).toBe(expected ? 1 : 0);
            expect(admission.disposition).toBe(expected ? "admitted" : "not_executed");
          }
        }
      }
    }
  });

  it("preserves the invariants across reproducible generated cut schedules", () => {
    const next = (value: number): number => (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    for (let seed = 1; seed <= 128; seed++) {
      let random = seed;
      for (let step = 0; step < 32; step++) {
        random = next(random);
        const operation = LIFECYCLE_OPERATIONS[random % LIFECYCLE_OPERATIONS.length]!;
        random = next(random);
        const boundary = LIFECYCLE_BOUNDARIES[random % LIFECYCLE_BOUNDARIES.length]!;
        random = next(random);
        const event = LIFECYCLE_EVENTS[random % LIFECYCLE_EVENTS.length]!;
        const outcome = evaluateLifecycleCut(operation, boundary, event);
        expect(outcome.dispatchCount, `seed=${seed} step=${step}`).toBeLessThanOrEqual(1);
        expect(outcome.reviewRequired && outcome.terminal, `seed=${seed} step=${step}`).toBe(false);
        expect(
          outcome.settlement === "outcome_unknown" && outcome.replayable,
          `seed=${seed} step=${step}`,
        ).toBe(false);
        expect(outcome.rendererContinuation, `seed=${seed} step=${step}`).toBe(false);
        expect(outcome.successorDispatch, `seed=${seed} step=${step}`).toBe(false);
        expect(outcome.composerCleared, `seed=${seed} step=${step}`).toBe(false);
      }
    }
  });
});
