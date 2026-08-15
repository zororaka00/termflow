export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'warning'
  | 'cancelled'
  | 'skipped';

export type AnsiMode = 'auto' | 'always' | 'never';

/** A monotonic clock used to calculate elapsed task time. */
export interface TaskClock {
  now(): number;
}

/** A timer handle that may opt out of keeping the Node.js event loop alive. */
export interface TaskTimer {
  unref?(): void;
}

/** Timer functions used for deterministic tests or specialized runtimes. */
export interface TaskScheduler {
  setInterval(callback: () => void, delayMs: number): TaskTimer;
  clearInterval(timer: TaskTimer): void;
}

export interface TaskOptions {
  message: string;
  stream?: NodeJS.WritableStream & { isTTY?: boolean };
  total?: number;
  current?: number;
  ansi?: AnsiMode;
  /** Optional deterministic clock. Defaults to Date.now(). */
  clock?: TaskClock;
  /** Optional deterministic interval scheduler. */
  scheduler?: TaskScheduler;
}

export interface Task {
  readonly status: TaskStatus;
  readonly message: string;
  readonly current: number;
  readonly total?: number;

  start(): Task;
  update(message: string): Task;
  setProgress(current: number, total?: number): Task;

  succeed(message?: string): Task;
  fail(message?: string): Task;
  warn(message?: string): Task;
  cancel(message?: string): Task;
  skip(message?: string): Task;
}
