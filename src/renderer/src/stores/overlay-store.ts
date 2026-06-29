// Overlay-claim registry: a ref-counted counter of ESC-owning surfaces currently
// open. The global ESC-to-interrupt handler consults hasClaim() to decide whether
// to defer (let the open surface handle ESC) or interrupt the agent.
//
// INVARIANTS (L2): O1 hasClaim() true iff >=1 surface open; O2 never orphaned
// (ref-counted, StrictMode-safe); O3 advisory (only the ESC handler reads it).
//
// Why a counter, not Set<string>: ids collide when a component mounts more than
// once (BranchDropdown is reused; SessionHeader has two dropdowns). Each open
// instance contributes +1, so the count is correct regardless of identity.

import { create } from "zustand";

interface OverlayState {
  count: number;
  /** Acquire a claim. Idempotent-safe via ref-counting. Internal. */
  _acquire: () => void;
  /** Release a claim. Clamped at 0 (defense in depth). Internal. */
  _release: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  count: 0,
  _acquire: () => set((s) => ({ count: s.count + 1 })),
  _release: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}));

/** Non-reactive read for event handlers (do not subscribe in render). */
export function hasClaim(): boolean {
  return useOverlayStore.getState().count > 0;
}
