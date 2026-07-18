import type { ExtensionUpdateStatus } from "@shared/extension-updates.js";
import { create } from "zustand";

interface ExtensionUpdatesStore {
  status: ExtensionUpdateStatus | null;
  checking: boolean;
  error: string | null;
  setStatus: (status: ExtensionUpdateStatus) => void;
}

let extensionCheckInFlight: Promise<ExtensionUpdateStatus> | null = null;

export const useExtensionUpdatesStore = create<ExtensionUpdatesStore>((set) => ({
  status: null,
  checking: false,
  error: null,
  setStatus: (status) =>
    set((state) =>
      state.status && state.status.checkedAt > status.checkedAt ? {} : { status, error: null },
    ),
}));

/**
 * Renderer-side single flight complements main's process-wide claim: React
 * Strict Mode, Settings mount, and a manual click cannot create duplicate IPC
 * requests while one check is already settling.
 */
export function checkExtensionUpdates(
  invoke: () => Promise<ExtensionUpdateStatus> = () =>
    window.pivis.invoke("extensionUpdates.check", undefined),
): Promise<ExtensionUpdateStatus> {
  if (extensionCheckInFlight) return extensionCheckInFlight;

  useExtensionUpdatesStore.setState({ checking: true, error: null });
  const operation = invoke()
    .then((status) => {
      useExtensionUpdatesStore.setState({ status, error: null });
      return status;
    })
    .catch((error: unknown) => {
      useExtensionUpdatesStore.setState({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      if (extensionCheckInFlight === operation) {
        extensionCheckInFlight = null;
        useExtensionUpdatesStore.setState({ checking: false });
      }
    });
  extensionCheckInFlight = operation;
  return operation;
}
