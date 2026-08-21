/**
 * Ordered verification contract for a public release.
 *
 * Keep this list data-only so the release command and its regression gate use
 * the same source of truth. The clean-install step runs before any checks so
 * electron-builder can never package a stale or locally mutated dependency
 * tree.
 */
export const RELEASE_CHECKS = Object.freeze([
  Object.freeze(["npm", Object.freeze(["ci"])]),
  Object.freeze(["npm", Object.freeze(["audit", "--omit=dev"])]),
  Object.freeze(["npm", Object.freeze(["run", "typecheck"])]),
  Object.freeze(["npm", Object.freeze(["run", "lint"])]),
  Object.freeze(["npm", Object.freeze(["test"])]),
  Object.freeze(["npm", Object.freeze(["run", "test:render"])]),
  Object.freeze(["npm", Object.freeze(["run", "test:e2e"])]),
  Object.freeze(["npm", Object.freeze(["ls", "--all"])]),
]);
