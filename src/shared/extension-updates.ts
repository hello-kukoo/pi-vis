/** Extension-package update awareness, intentionally separate from Pi-Vis app updates. */

export interface ExtensionUpdate {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user";
}

export interface ExtensionUpdateStatus {
  updates: ExtensionUpdate[];
  checkedAt: number;
}

/** The pinned pi runtime is deliberately not an update target. */
export type ExtensionUpdateTarget = "all" | { extension: string };

export interface ExtensionUpdateRunResult {
  exitCode: number;
  timedOut: boolean;
}
