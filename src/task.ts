import { CLEAR_LINE, shouldUseTtyRenderer } from './ansi.js';
import { performance } from 'node:perf_hooks';
import { formatLogLine, PlainRenderer, writePlainLine } from './plain-renderer.js';
import type { Renderer, RenderView } from './renderer.js';
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from './spinner.js';
import { TtyRenderer } from './tty-renderer.js';
import type {
  AnsiMode,
  Task,
  TaskClock,
  TaskFinalRecord,
  TaskFormat,
  TaskOptions,
  PlainOutputPolicy,
  RenderMode,
  TaskProgressBarOptions,
  TaskScheduler,
  TaskStatus,
  TaskTimer,
  TerminalTaskStatus,
} from './types.js';

const defaultClock: TaskClock = {
  now: () => performance.now(),
};

const defaultScheduler: TaskScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
};

const TERMINAL_CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

export function assertTaskOptionValues(
  options: Pick<
    TaskOptions,
    | 'ansi'
    | 'columns'
    | 'clock'
    | 'format'
    | 'plainOutput'
    | 'progressBar'
    | 'renderMode'
    | 'scheduler'
    | 'spinnerFrames'
    | 'statusSymbols'
  >,
): void {
  assertAnsiMode(options.ansi);
  assertRenderMode(options.renderMode);
  assertSpinnerFrames(options.spinnerFrames);
  assertStatusSymbols(options.statusSymbols);
  assertProgressBar(options.progressBar);
  assertFormat(options.format);
  assertPlainOutputPolicy(options.plainOutput);
  assertColumns(options.columns);
  if (options.clock !== undefined && typeof options.clock.now !== 'function') {
    throw new TypeError('clock must provide a now method.');
  }
  if (
    options.scheduler !== undefined &&
    (typeof options.scheduler.setInterval !== 'function' ||
      typeof options.scheduler.clearInterval !== 'function')
  ) {
    throw new TypeError('scheduler must provide setInterval and clearInterval methods.');
  }
}

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
  #silent = false;
  #columns: number | undefined;
  #plainOutput: PlainOutputPolicy;
  #plainDirty = false;
  #lastPlainRenderAt: number | undefined;
  #hasActiveLine = false;
  #startedAt: number | undefined;
  #finalRecord: TaskFinalRecord | undefined;
  #disposed = false;
  #timer: TaskTimer | undefined;
  #spinnerIndex = 0;
  #spinnerFrames: readonly string[];
  #statusSymbols: Partial<Record<TaskStatus, string>> | undefined;
  #progressBar: TaskProgressBarOptions | undefined;
  #format: TaskFormat | undefined;

  constructor(options: TaskOptions) {
    assertMessage(options.message);
    assertTaskOptionValues(options);
    this.#current = options.current === undefined ? 0 : options.current;
    this.#total = options.total;
    assertNonNegativeFinite('current', this.#current);
    if (this.#total !== undefined) {
      assertNonNegativeFinite('total', this.#total);
      assertCurrentWithinTotal(this.#current, this.#total);
    }

    const stream = options.stream === undefined ? process.stderr : options.stream;
    if (stream === null || typeof stream.write !== 'function') {
      throw new TypeError('stream must provide a write method.');
    }

    const clock = options.clock ?? defaultClock;
    const scheduler = options.scheduler ?? defaultScheduler;

    this.#message = options.message;
    this.#stream = stream;
    this.#clock = clock;
    this.#scheduler = scheduler;
    const renderMode = options.renderMode ?? 'auto';
    this.#interactive = shouldUseInteractiveRenderer(renderMode, options.ansi ?? 'auto', stream);
    this.#silent = renderMode === 'silent';
    this.#columns = resolveColumns(options.columns, stream);
    this.#plainOutput = snapshotPlainOutputPolicy(options.plainOutput);
    this.#spinnerFrames = snapshotSpinnerFrames(options.spinnerFrames);
    this.#statusSymbols = snapshotStatusSymbols(options.statusSymbols);
    this.#progressBar = snapshotProgressBar(options.progressBar);
    this.#format = options.format;
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
    this.#assertNotDisposed('start');
    if (this.#status === 'running') {
      return this;
    }
    this.#assertMutable('start');

    this.#status = 'running';
    this.#startedAt = this.#clock.now();
    this.#renderActive('start');
    this.#startTimer();
    return this;
  }

  update(message: string): Task {
    this.#assertMutable('update');
    assertMessage(message);
    this.#message = message;
    this.#plainDirty = true;
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
    this.#plainDirty = true;
    this.#renderIfRunning();
    return this;
  }

  stop(): void {
    this.#assertNotDisposed('stop');
    this.#stopTimer();
  }

  clear(): void {
    this.#assertNotDisposed('clear');
    if (this.#interactive && this.#hasActiveLine) {
      this.#stream.write(CLEAR_LINE);
      this.#hasActiveLine = false;
    }
  }

  persist(): TaskFinalRecord {
    this.#assertNotDisposed('persist');
    if (!isTerminalStatus(this.#status) || this.#finalRecord === undefined) {
      throw new Error('Cannot persist a non-terminal task.');
    }
    return this.#finalRecord;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#stopTimer();
    this.#disposed = true;
  }

  log(record: string): void {
    this.#assertNotDisposed('log');
    assertMessage(record);
    if (this.#silent || (!this.#interactive && this.#plainOutput === 'silent')) {
      return;
    }
    if (this.#interactive && this.#status === 'running' && this.#hasActiveLine) {
      this.#stream.write(CLEAR_LINE);
      writePlainLine(this.#stream, formatLogLine(record, this.#columns));
      this.#renderActive();
      return;
    }
    writePlainLine(this.#stream, formatLogLine(record, this.#columns));
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
    this.#assertNotDisposed(nextStatus);
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
    this.#finalRecord = Object.freeze({
      status: nextStatus as TerminalTaskStatus,
      message: this.#message,
      current: this.#current,
      total: this.#total,
      elapsedMs: this.#elapsedMs(),
    });
    this.#renderFinal();
    return this;
  }

  #renderIfRunning(): void {
    if (this.#status === 'running') {
      this.#renderActive();
    }
  }

  #renderActive(reason: 'start' | 'update' = 'update'): void {
    if (this.#silent) {
      return;
    }
    if (!this.#interactive && !this.#shouldRenderPlainActive(reason)) {
      return;
    }
    this.#renderer.renderActive(this.#renderView());
    if (this.#interactive) {
      this.#hasActiveLine = true;
    } else {
      this.#plainDirty = false;
      this.#lastPlainRenderAt = this.#clock.now();
    }
  }

  #shouldRenderPlainActive(reason: 'start' | 'update'): boolean {
    if (this.#plainOutput === 'all') {
      return true;
    }
    if (this.#plainOutput === 'start-and-final') {
      return reason === 'start';
    }
    const intervalMs = this.#periodicInterval();
    return (
      intervalMs !== undefined &&
      (reason === 'start' ||
        (this.#plainDirty &&
          (this.#lastPlainRenderAt === undefined ||
            this.#clock.now() - this.#lastPlainRenderAt >= intervalMs)))
    );
  }

  #renderFinal(): void {
    if (this.#silent || (!this.#interactive && this.#plainOutput === 'silent')) {
      return;
    }
    this.#renderer.renderFinal(
      this.#renderView(this.#finalRecord?.elapsedMs ?? this.#elapsedMs()),
      this.#hasActiveLine,
    );
    this.#hasActiveLine = false;
  }

  #renderView(elapsedMs = this.#elapsedMs()): RenderView {
    return Object.freeze({
      status: this.#status,
      message: this.#message,
      current: this.#current,
      total: this.#total,
      elapsedMs,
      spinnerFrame: this.#spinnerFrames[this.#spinnerIndex],
      statusSymbol: this.#statusSymbols?.[this.#status],
      progressBar: this.#progressBar,
      format: this.#format,
      columns: this.#columns,
    });
  }

  #elapsedMs(): number {
    return this.#startedAt === undefined
      ? 0
      : Math.max(0, this.#clock.now() - this.#startedAt);
  }

  #startTimer(): void {
    const periodicIntervalMs = this.#periodicInterval();
    if (this.#silent || (!this.#interactive && periodicIntervalMs === undefined)) {
      return;
    }

    this.#timer = this.#scheduler.setInterval(() => {
      if (this.#status !== 'running') {
        return;
      }
      if (this.#interactive) {
        this.#spinnerIndex = (this.#spinnerIndex + 1) % this.#spinnerFrames.length;
        this.#renderActive();
      } else if (this.#plainDirty) {
        this.#renderActive();
      }
    }, periodicIntervalMs ?? SPINNER_INTERVAL_MS);
    this.#timer.unref?.();
  }

  #periodicInterval(): number | undefined {
    return typeof this.#plainOutput === 'object' ? this.#plainOutput.intervalMs : undefined;
  }

  #stopTimer(): void {
    if (this.#timer !== undefined) {
      this.#scheduler.clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  #assertMutable(operation: string): void {
    this.#assertNotDisposed(operation);
    if (this.#status !== 'pending' && this.#status !== 'running') {
      throw new Error(`Cannot ${operation} a terminal task (${this.#status}).`);
    }
  }

  #assertNotDisposed(operation: string): void {
    if (this.#disposed) {
      throw new Error(`Cannot ${operation} a disposed task.`);
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

function assertRenderMode(mode: unknown): asserts mode is RenderMode | undefined {
  if (
    mode !== undefined &&
    mode !== 'auto' &&
    mode !== 'interactive' &&
    mode !== 'static' &&
    mode !== 'accessible' &&
    mode !== 'silent'
  ) {
    throw new TypeError(
      'renderMode must be "auto", "interactive", "static", "accessible", or "silent".',
    );
  }
}

function assertSpinnerFrames(frames: unknown): asserts frames is readonly string[] | undefined {
  if (
    frames !== undefined &&
    (!Array.isArray(frames) ||
      frames.length === 0 ||
      Array.from(frames).some(
        (frame) =>
          typeof frame !== 'string' || frame.length === 0 || TERMINAL_CONTROL.test(frame),
      ))
  ) {
    throw new RangeError(
      'spinnerFrames must be a non-empty array of terminal-control-free strings.',
    );
  }
}

export function snapshotSpinnerFrames(frames: readonly string[] | undefined): readonly string[] {
  const snapshot = Object.freeze([...(frames ?? SPINNER_FRAMES)]);
  assertSpinnerFrames(snapshot);
  return snapshot;
}

function assertStatusSymbols(
  symbols: unknown,
): asserts symbols is Partial<Record<TaskStatus, string>> | undefined {
  if (symbols === undefined) {
    return;
  }
  if (
    typeof symbols !== 'object' ||
    symbols === null ||
    Object.values(symbols).some(
      (symbol) =>
        typeof symbol !== 'string' || symbol.length === 0 || TERMINAL_CONTROL.test(symbol),
    )
  ) {
    throw new RangeError(
      'statusSymbols must map task statuses to non-empty, terminal-control-free strings.',
    );
  }
}

export function snapshotStatusSymbols(
  symbols: Partial<Record<TaskStatus, string>> | undefined,
): Partial<Record<TaskStatus, string>> | undefined {
  if (symbols === undefined) {
    return undefined;
  }
  const snapshot = Object.freeze({ ...symbols });
  assertStatusSymbols(snapshot);
  return snapshot;
}

function assertProgressBar(
  progressBar: unknown,
): asserts progressBar is TaskProgressBarOptions | undefined {
  if (progressBar === undefined) {
    return;
  }
  if (typeof progressBar !== 'object' || progressBar === null) {
    throw new RangeError('progressBar must be an object.');
  }
  const { complete, remaining, width } = progressBar as TaskProgressBarOptions;
  if (
    (complete !== undefined &&
      (typeof complete !== 'string' || complete.length === 0 || TERMINAL_CONTROL.test(complete))) ||
    (remaining !== undefined &&
      (typeof remaining !== 'string' ||
        remaining.length === 0 ||
        TERMINAL_CONTROL.test(remaining))) ||
    (width !== undefined &&
      (typeof width !== 'number' ||
        !Number.isFinite(width) ||
        width < 0 ||
        !Number.isInteger(width)))
  ) {
    throw new RangeError(
      'progressBar complete and remaining must be non-empty, terminal-control-free strings and width must be a finite, non-negative integer.',
    );
  }
}

export function snapshotProgressBar(
  progressBar: TaskProgressBarOptions | undefined,
): TaskProgressBarOptions | undefined {
  if (progressBar === undefined) {
    return undefined;
  }
  const snapshot = Object.freeze({ ...progressBar });
  assertProgressBar(snapshot);
  return snapshot;
}

function assertFormat(format: unknown): asserts format is TaskFormat | undefined {
  if (format !== undefined && typeof format !== 'function') {
    throw new TypeError('format must be a function.');
  }
}

function shouldUseInteractiveRenderer(
  renderMode: RenderMode,
  ansi: AnsiMode,
  stream: { isTTY?: boolean },
): boolean {
  if (renderMode === 'auto') {
    return shouldUseTtyRenderer(ansi, stream);
  }
  if (renderMode !== 'interactive') {
    return false;
  }
  return shouldUseTtyRenderer(ansi === 'always' ? 'auto' : ansi, stream);
}

function assertPlainOutputPolicy(
  policy: unknown,
): asserts policy is PlainOutputPolicy | undefined {
  if (
    policy === undefined ||
    policy === 'all' ||
    policy === 'start-and-final' ||
    policy === 'final-only' ||
    policy === 'silent'
  ) {
    return;
  }
  if (
    typeof policy === 'object' &&
    policy !== null &&
    'type' in policy &&
    policy.type === 'periodic' &&
    'intervalMs' in policy &&
    typeof policy.intervalMs === 'number' &&
    Number.isFinite(policy.intervalMs) &&
    policy.intervalMs > 0
  ) {
    return;
  }
  throw new RangeError(
    'plainOutput must be "all", "start-and-final", "final-only", "silent", or a periodic policy with a finite, positive intervalMs.',
  );
}

export function snapshotPlainOutputPolicy(policy: PlainOutputPolicy | undefined): PlainOutputPolicy {
  if (typeof policy === 'object') {
    const snapshot = { type: 'periodic' as const, intervalMs: policy.intervalMs };
    assertPlainOutputPolicy(snapshot);
    return Object.freeze(snapshot);
  }
  return policy ?? 'all';
}

function assertColumns(columns: unknown): asserts columns is number | undefined {
  if (
    columns !== undefined &&
    (typeof columns !== 'number' ||
      !Number.isFinite(columns) ||
      columns < 0 ||
      !Number.isInteger(columns))
  ) {
    throw new RangeError('columns must be a finite, non-negative integer.');
  }
}

function resolveColumns(
  explicitColumns: number | undefined,
  stream: { columns?: unknown },
): number | undefined {
  if (explicitColumns !== undefined) {
    return explicitColumns;
  }
  const { columns } = stream;
  return typeof columns === 'number' && Number.isFinite(columns) && columns >= 0
    ? Math.floor(columns)
    : undefined;
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

function isTerminalStatus(status: TaskStatus): status is TerminalTaskStatus {
  return status !== 'pending' && status !== 'running';
}

export function createTask(options: TaskOptions): Task {
  return new TermflowTask(options);
}
