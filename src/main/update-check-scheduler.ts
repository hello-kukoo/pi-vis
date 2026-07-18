export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface UpdateCheckSchedulerOptions {
  isAppUpdateEnabled: () => boolean;
  isExtensionUpdateEnabled: () => boolean;
  checkAppUpdate: () => unknown;
  checkExtensionUpdates: () => unknown;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  initialDelayMs?: number;
  intervalMs?: number;
}

type CheckKind = "app" | "extensions";

/**
 * Main-process-only due-time scheduler. Timers merely wake it up; timestamps
 * decide whether work is allowed, so delayed timers and system sleep result in
 * one overdue check rather than overlapping or missed periodic work.
 */
export class UpdateCheckScheduler {
  private readonly now: () => number;
  private readonly setTimer: NonNullable<UpdateCheckSchedulerOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<UpdateCheckSchedulerOptions["clearTimer"]>;
  private readonly initialDelayMs: number;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private started = false;
  private lastAttemptedAt: Record<CheckKind, number | null> = { app: null, extensions: null };

  constructor(private readonly options: UpdateCheckSchedulerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.initialDelayMs = options.initialDelayMs ?? 5000;
    this.intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(this.initialDelayMs);
  }

  stop(): void {
    this.started = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  /** Re-evaluate preferences after Settings changes or system resume. */
  refresh(): void {
    if (!this.started) return;
    void this.runDueChecks();
  }

  getLastAttemptedAt(kind: CheckKind): number | null {
    return this.lastAttemptedAt[kind];
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        void this.runDueChecks();
      },
      Math.max(0, delayMs),
    );
  }

  private runDueChecks(): Promise<void> {
    if (this.running) return this.running;
    const now = this.now();
    const due: Array<Promise<unknown>> = [];

    if (this.options.isAppUpdateEnabled() && this.isDue("app", now)) {
      this.lastAttemptedAt.app = now;
      due.push(Promise.resolve().then(this.options.checkAppUpdate));
    }
    if (this.options.isExtensionUpdateEnabled() && this.isDue("extensions", now)) {
      this.lastAttemptedAt.extensions = now;
      due.push(Promise.resolve().then(this.options.checkExtensionUpdates));
    }

    this.running = Promise.allSettled(due)
      .then(() => undefined)
      .finally(() => {
        this.running = null;
        this.scheduleNext();
      });
    return this.running;
  }

  private isDue(kind: CheckKind, now: number): boolean {
    const lastAttemptedAt = this.lastAttemptedAt[kind];
    return lastAttemptedAt === null || now - lastAttemptedAt >= this.intervalMs;
  }

  private scheduleNext(): void {
    if (!this.started) return;
    const now = this.now();
    const next: number[] = [];
    if (this.options.isAppUpdateEnabled()) next.push(this.nextDueAt("app", now));
    if (this.options.isExtensionUpdateEnabled()) next.push(this.nextDueAt("extensions", now));
    if (next.length === 0) return;
    this.schedule(Math.min(...next) - now);
  }

  private nextDueAt(kind: CheckKind, now: number): number {
    const lastAttemptedAt = this.lastAttemptedAt[kind];
    return lastAttemptedAt === null ? now : lastAttemptedAt + this.intervalMs;
  }
}
