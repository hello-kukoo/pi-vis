export const LIFECYCLE_OPERATIONS = [
  "submission",
  "effectful-command",
  "reload",
  "escape",
  "editor-patch",
  "picker-continuation",
  "unified-unclaimed",
  "unified-claimed",
] as const;

export type LifecycleOperation = (typeof LIFECYCLE_OPERATIONS)[number];

export const LIFECYCLE_BOUNDARIES = [
  "before-dispatch",
  "after-child-dispatch",
  "after-host-mutation",
  "after-main-settlement",
  "before-renderer-continuation",
] as const;

export type LifecycleBoundary = (typeof LIFECYCLE_BOUNDARIES)[number];

export const LIFECYCLE_EVENTS = ["renderer-detach", "runtime-replacement", "close-freeze"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

export interface LifecycleOutcome {
  dispatched: boolean;
  dispatchCount: 0 | 1;
  possibleHostMutation: boolean;
  settlement: "not_executed" | "outcome_unknown" | "completed" | "fenced";
  terminal: boolean;
  replayable: boolean;
  reviewRequired: boolean;
  outcomeUnknownReplayAllowed: false;
  successorDispatch: boolean;
  rendererContinuation: boolean;
  composerCleared: false;
  editorRevisionMayApply: boolean;
  claimTransferred: boolean;
  ingressFrozen: boolean;
  successorIdentityRequired: boolean;
  unavailableAdmissionAllowed: false;
}

export interface LifecycleAdmission {
  admitted: boolean;
  dispatchCount: 0 | 1;
  disposition: "admitted" | "not_executed";
}

/** Reference admission gate used by generated availability/identity schedules. */
export function evaluateLifecycleAdmission(input: {
  available: boolean;
  transitioning: boolean;
  closing: boolean;
  identityMatches: boolean;
}): LifecycleAdmission {
  const admitted =
    input.available && !input.transitioning && !input.closing && input.identityMatches;
  return {
    admitted,
    dispatchCount: admitted ? 1 : 0,
    disposition: admitted ? "admitted" : "not_executed",
  };
}

const boundaryIndex = (boundary: LifecycleBoundary): number =>
  LIFECYCLE_BOUNDARIES.indexOf(boundary);

/**
 * Finite reference model for lifecycle-cut behavior. It intentionally models
 * only Pi-Vis's internal admission boundaries; it is not a model of arbitrary
 * extension, provider, platform, or JavaScript scheduling behavior.
 */
export function evaluateLifecycleCut(
  operation: LifecycleOperation,
  boundary: LifecycleBoundary,
  event: LifecycleEvent,
): LifecycleOutcome {
  const index = boundaryIndex(boundary);
  const dispatched = index >= boundaryIndex("after-child-dispatch");
  const possibleHostMutation =
    operation !== "picker-continuation" && index >= boundaryIndex("after-host-mutation");
  const effectCouldBeAmbiguous = [
    "submission",
    "effectful-command",
    "reload",
    "escape",
    "unified-claimed",
  ].includes(operation);
  const settled = index >= boundaryIndex("after-main-settlement");
  const ambiguousAfterCut =
    !settled &&
    (effectCouldBeAmbiguous || operation === "unified-claimed") &&
    (dispatched || operation === "unified-claimed");
  const settlement: LifecycleOutcome["settlement"] = settled
    ? "completed"
    : ambiguousAfterCut
      ? "outcome_unknown"
      : dispatched
        ? "fenced"
        : "not_executed";
  const reviewRequired = settlement === "outcome_unknown";

  // Only work that provably never crossed dispatch may transfer. A unified
  // request is additionally transferable only before a renderer claims it.
  const replayable =
    event === "renderer-detach" &&
    !dispatched &&
    (operation === "submission" ||
      operation === "picker-continuation" ||
      operation === "unified-unclaimed");

  // A lifecycle cut always fences the predecessor renderer/runtime. The model
  // does not permit automatic dispatch into the successor; replayable work
  // must first re-enter its explicit review/admission surface.
  const successorDispatch = false;
  const rendererContinuation = false;
  // Every modeled lifecycle event retires the predecessor continuation. An
  // editor patch must be re-admitted from the surviving renderer/runtime.
  const editorRevisionMayApply = false;
  const claimTransferred =
    event === "renderer-detach" && operation === "unified-unclaimed" && !dispatched;
  const ingressFrozen = event === "close-freeze";
  const successorIdentityRequired = event === "runtime-replacement";

  return {
    dispatched,
    dispatchCount: dispatched ? 1 : 0,
    possibleHostMutation,
    settlement,
    terminal: settlement === "completed" || settlement === "not_executed",
    replayable,
    reviewRequired,
    outcomeUnknownReplayAllowed: false,
    successorDispatch,
    rendererContinuation,
    composerCleared: false,
    editorRevisionMayApply,
    claimTransferred,
    ingressFrozen,
    successorIdentityRequired,
    unavailableAdmissionAllowed: false,
  };
}
