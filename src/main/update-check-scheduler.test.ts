import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateCheckScheduler } from "./update-check-scheduler.js";

describe("UpdateCheckScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("uses timestamps to run the delayed startup check and then hourly checks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const checkAppUpdate = vi.fn();
    const checkExtensionUpdates = vi.fn();
    const scheduler = new UpdateCheckScheduler({
      isAppUpdateEnabled: () => true,
      isExtensionUpdateEnabled: () => true,
      checkAppUpdate,
      checkExtensionUpdates,
      initialDelayMs: 5000,
      intervalMs: 60 * 60 * 1000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkAppUpdate).toHaveBeenCalledOnce();
    expect(checkExtensionUpdates).toHaveBeenCalledOnce();
    expect(scheduler.getLastAttemptedAt("app")).toBe(Date.now());

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
    expect(checkAppUpdate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(checkAppUpdate).toHaveBeenCalledTimes(2);
    expect(checkExtensionUpdates).toHaveBeenCalledTimes(2);
  });

  it("does not overlap checks, retries failures at the next due time, and observes preferences", async () => {
    vi.useFakeTimers();
    let enabled = true;
    let resolveCheck: (() => void) | undefined;
    const checkAppUpdate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const checkExtensionUpdates = vi.fn(async () => {
      throw new Error("offline");
    });
    const scheduler = new UpdateCheckScheduler({
      isAppUpdateEnabled: () => enabled,
      isExtensionUpdateEnabled: () => enabled,
      checkAppUpdate,
      checkExtensionUpdates,
      initialDelayMs: 0,
      intervalMs: 1000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(checkAppUpdate).toHaveBeenCalledOnce();
    expect(checkExtensionUpdates).toHaveBeenCalledOnce();

    scheduler.refresh();
    expect(checkAppUpdate).toHaveBeenCalledOnce();
    resolveCheck?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(checkAppUpdate).toHaveBeenCalledTimes(2);
    expect(checkExtensionUpdates).toHaveBeenCalledTimes(2);

    enabled = false;
    scheduler.refresh();
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkAppUpdate).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
