import type { UpdateStatus } from "@shared/updates.js";
import { create } from "zustand";

interface UpdatesStore {
  status: UpdateStatus | null;
  activeRun: { runId: string; lines: string[]; done?: boolean; exitCode?: number } | null;
  setStatus: (status: UpdateStatus) => void;
  setActiveRun: (
    run: { runId: string; lines: string[]; done?: boolean; exitCode?: number } | null,
  ) => void;
  appendOutput: (runId: string, chunk: string) => void;
  markDone: (runId: string, exitCode: number) => void;
  dismiss: () => void;
}

export const useUpdatesStore = create<UpdatesStore>((set) => ({
  status: null,
  activeRun: null,

  setStatus: (status) => set({ status }),

  setActiveRun: (run) => set({ activeRun: run }),

  appendOutput: (runId, chunk) => {
    set((state) => {
      if (state.activeRun?.runId !== runId) return {};
      return {
        activeRun: {
          ...state.activeRun,
          lines: [...state.activeRun.lines, chunk],
        },
      };
    });
  },

  markDone: (runId, exitCode) =>
    set((state) =>
      state.activeRun?.runId === runId
        ? { activeRun: { ...state.activeRun, done: true, exitCode } }
        : {},
    ),

  dismiss: () => set({ status: null }),
}));
