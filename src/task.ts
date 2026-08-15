import { shouldUseTtyRenderer } from './ansi.js';
import { PlainRenderer } from './plain-renderer.js';
import type { Renderer, RenderView } from './renderer.js';
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from './spinner.js';
import { TtyRenderer } from './tty-renderer.js';
import type {
  AnsiMode,
  Task,
  TaskClock,
  TaskOptions,
  TaskScheduler,
  TaskStatus,
  TaskTimer,
} from './types.js';

const defaultClock: TaskClock = {
  now: () => Date.now(),
};

const defaultScheduler: TaskScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
};

class TermflowTask implements Task {
  #status: TaskStatus = 'pending';
  #message: string;
  #current: number;
  #total: number | undefined;
  #stream: NodeJS.WritableStream;
  #clock: TaskClock;
  #scheduler: TaskScheduler;
  #renderer: Renderer;
  #interactive: boolean;
  #startedAt: number | undefined;
  #timer: TaskTimer | undefined;
  #spinnerIndex = 0;

  constructor(options: TaskOptions) {
    assertMessage(options.message);
    assertAnsiMode(options.ansi);
    this.#current = options.current ?? 0;
    this.#total = options.total;
    assertNonNegativeFinite('current', this.#current);
    if (this.#total !== undefined) {
      assertNonNegativeFinite('total', this.#total);
      assertCurrentWithinTotal(this.#current, this.#total);
    }

    const stream = options.stream ?? process.stderr;
    if (typeof stream.write !== 'function') {
      throw new TypeError('stream must provide a write method.');
    }

    const clock = options.clock ?? defaultClock;
    if (typeof clock.now !== 'function') {
      throw new TypeError('clock must provide a now method.');
    }
    const scheduler = options.scheduler ?? defaultScheduler;
    if (
      typeof scheduler.setInterval !== 'function' ||
      typeof scheduler.clearInterval !== 'function'
    ) {
      throw new TypeError('scheduler must provide setInterval and clearInterval methods.');
    }

    this.#message = options.message;
    this.#stream = stream;
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#interactive = shouldUseTtyRenderer(options.ansi ?? 'auto', stream);
    this.#renderer = this.#interactive ? new TtyRenderer(stream) : new PlainRenderer(stream);
  }

  get status(): TaskStatus {
    return this.#status;
  }

  get message(): string {
    return this.#message;
  }

  get current(): number {
    return this.#current;
  }

  get total(): number | undefined {
    return this.#total;
  }

  start(): Task {
    if (this.#status === 'running') {
      return this;
    }
    this.#assertMutable('start');

    this.#status = 'running';
    this.#startedAt = this.#clock.now();
    this.#renderActive();
    this.#startTimer();
    return this;
  }

  update(message: string): Task {
    this.#assertMutable('update');
    assertMessage(message);
    this.#message = message;
    this.#renderIfRunning();
    return this;
  }

  setProgress(current: number, total?: number): Task {
    this.#assertMutable('setProgress');
    assertNonNegativeFinite('current', current);

    const nextTotal = total === undefined ? this.#total : total;
    if (nextTotal !== undefined) {
      assertNonNegativeFinite('total', nextTotal);
      assertCurrentWithinTotal(current, nextTotal);
    }

    this.#current = current;
    this.#total = nextTotal;
    this.#renderIfRunning();
    return this;
  }

  succeed(message?: string): Task {
    return this.#finish('success', message);
  }

  fail(message?: string): Task {
    return this.#finish('failure', message);
  }

  warn(message?: string): Task {
    return this.#finish('warning', message);
  }

  cancel(message?: string): Task {
    return this.#finish('cancelled', message);
  }

  skip(message?: string): Task {
    return this.#finish('skipped', message);
  }

  #finish(nextStatus: TaskStatus, message: string | undefined): Task {
    if (this.#status === nextStatus) {
      return this;
    }
    if (this.#status !== 'pending' && this.#status !== 'running') {
      throw new Error(`Invalid task transition: ${this.#status} -> ${nextStatus}.`);
    }

    if (message !== undefined) {
      assertMessage(message);
      this.#message = message;
    }

    this.#stopTimer();
    this.#status = nextStatus;
    this.#renderFinal();
    return this;
  }

  #renderIfRunning(): void {
    if (this.#status === 'running') {
      this.#renderActive();
    }
  }

  #renderActive(): void {
    this.#renderer.renderActive(this.#renderView());
  }

  #renderFinal(): void {
    this.#renderer.renderFinal(this.#renderView());
  }

  #renderView(): RenderView {
    return {
      status: this.#status,
      message: this.#message,
      current: this.#current,
      total: this.#total,
      elapsedMs: this.#elapsedMs(),
      spinnerFrame: SPINNER_FRAMES[this.#spinnerIndex],
    };
  }

  #elapsedMs(): number {
    return this.#startedAt === undefined
      ? 0
      : Math.max(0, this.#clock.now() - this.#startedAt);
  }

  #startTimer(): void {
    if (!this.#interactive) {
      return;
    }

    this.#timer = this.#scheduler.setInterval(() => {
      if (this.#status !== 'running') {
        return;
      }
      this.#spinnerIndex = (this.#spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.#renderActive();
    }, SPINNER_INTERVAL_MS);
    this.#timer.unref?.();
  }

  #stopTimer(): void {
    if (this.#timer !== undefined) {
      this.#scheduler.clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  #assertMutable(operation: string): void {
    if (this.#status !== 'pending' && this.#status !== 'running') {
      throw new Error(`Cannot ${operation} a terminal task (${this.#status}).`);
    }
  }
}

function assertMessage(message: unknown): asserts message is string {
  if (typeof message !== 'string') {
    throw new TypeError('message must be a string.');
  }
}

function assertAnsiMode(mode: unknown): asserts mode is AnsiMode | undefined {
  if (mode !== undefined && mode !== 'auto' && mode !== 'always' && mode !== 'never') {
    throw new TypeError('ansi must be "auto", "always", or "never".');
  }
}

function assertNonNegativeFinite(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
}

function assertCurrentWithinTotal(current: number, total: number): void {
  if (current > total) {
    throw new RangeError('current must be less than or equal to total.');
  }
}

export function createTask(options: TaskOptions): Task {
  return new TermflowTask(options);
}
