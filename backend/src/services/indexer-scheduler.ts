/**
 * Fixed-cadence, single-flight scheduler for the indexer watermark loop.
 *
 * A timer is always scheduled independently of the active poll. When a tick
 * arrives while the previous poll is still running, it is counted as an
 * overrun instead of starting overlapping work. Stopping clears the timer and
 * aborts the active poll before waiting for it to settle.
 */

export interface SchedulerClock {
  now(): number;
  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export interface WatermarkSchedulerOptions {
  intervalMs: number;
  runCycle: (signal: AbortSignal) => Promise<void>;
  onOverrun?: (skippedPolls: number) => void;
  onError?: (error: Error) => void;
  clock?: SchedulerClock;
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class WatermarkScheduler {
  private readonly intervalMs: number;
  private readonly runCycle: (signal: AbortSignal) => Promise<void>;
  private readonly onOverrun: (skippedPolls: number) => void;
  private readonly onError: (error: Error) => void;
  private readonly clock: SchedulerClock;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeCycle: Promise<void> | null = null;
  private activeController: AbortController | null = null;
  private nextRunAt = 0;
  private started = false;

  constructor(options: WatermarkSchedulerOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error("Indexer poll interval must be greater than zero");
    }

    this.intervalMs = options.intervalMs;
    this.runCycle = options.runCycle;
    this.onOverrun = options.onOverrun ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
    this.clock = options.clock ?? systemClock;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.nextRunAt = this.clock.now() + this.intervalMs;
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }

    this.activeController?.abort(new Error("Indexer scheduler stopped"));
    await this.activeCycle;
  }

  get isCycleActive(): boolean {
    return this.activeCycle !== null;
  }

  private scheduleNext(): void {
    if (!this.started) return;
    const delayMs = Math.max(0, this.nextRunAt - this.clock.now());
    this.timer = this.clock.setTimeout(() => this.tick(), delayMs);
  }

  private tick(): void {
    if (!this.started) return;
    this.timer = null;

    const now = this.clock.now();
    const lateIntervals = Math.max(
      0,
      Math.floor((now - this.nextRunAt) / this.intervalMs),
    );
    this.nextRunAt += (lateIntervals + 1) * this.intervalMs;
    this.scheduleNext();

    if (this.activeCycle !== null) {
      this.onOverrun(lateIntervals + 1);
      return;
    }

    if (lateIntervals > 0) this.onOverrun(lateIntervals);

    const controller = new AbortController();
    this.activeController = controller;
    this.activeCycle = this.runCycle(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          this.onError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })
      .finally(() => {
        this.activeController = null;
        this.activeCycle = null;
      });
  }
}
