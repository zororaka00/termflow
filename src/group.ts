import { formatLogLine, writePlainLine } from './plain-renderer.js';
import {
  assertTaskOptionValues,
  createTask,
  snapshotPlainOutputPolicy,
  snapshotProgressBar,
  snapshotSpinnerFrames,
  snapshotStatusSymbols,
} from './task.js';
import { truncateVisible } from './text.js';
import type {
  PlainOutputPolicy,
  RenderMode,
  Task,
  TaskClock,
  TaskFinalRecord,
  TaskFormat,
  TaskGroup,
  TaskGroupOptions,
  TaskGroupTaskOptions,
  TaskProgressBarOptions,
  TaskScheduler,
  TaskStatus,
} from './types.js';

const SUMMARY_STATUS_ORDER: readonly Exclude<TaskStatus, 'pending' | 'running'>[] = [
  'success',
  'failure',
  'warning',
  'cancelled',
  'skipped',
];

class GroupTask implements Task {
  #task: Task;
  #finalRecord: TaskFinalRecord | undefined;
  #disposed = false;

  constructor(task: Task) {
    this.#task = task;
  }

  get status(): TaskStatus {
    return this.#task.status;
  }

  get message(): string {
    return this.#task.message;
  }

  get current(): number {
    return this.#task.current;
  }

  get total(): number | undefined {
    return this.#task.total;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  start(): Task {
    this.#task.start();
    return this;
  }

  update(message: string): Task {
    this.#task.update(message);
    return this;
  }

  setProgress(current: number, total?: number): Task {
    this.#task.setProgress(current, total);
    return this;
  }

  stop(): void {
    this.#task.stop();
  }

  clear(): void {
    this.#task.clear();
  }

  persist(): TaskFinalRecord {
    return this.#task.persist();
  }

  dispose(): void {
    this.#task.dispose();
    this.#disposed = true;
  }

  log(record: string): void {
    this.#task.log(record);
  }

  succeed(message?: string): Task {
    this.#finish(() => this.#task.succeed(message));
    return this;
  }

  fail(message?: string): Task {
    this.#finish(() => this.#task.fail(message));
    return this;
  }

  warn(message?: string): Task {
    this.#finish(() => this.#task.warn(message));
    return this;
  }

  cancel(message?: string): Task {
    this.#finish(() => this.#task.cancel(message));
    return this;
  }

  skip(message?: string): Task {
    this.#finish(() => this.#task.skip(message));
    return this;
  }

  finalRecord(): TaskFinalRecord {
    if (this.#finalRecord === undefined) {
      this.#finalRecord = this.#task.persist();
    }
    return this.#finalRecord;
  }

  #finish(finish: () => Task): void {
    try {
      finish();
    } finally {
      this.#captureTerminalRecord();
    }
  }

  #captureTerminalRecord(): void {
    if (isTerminalTaskStatus(this.#task.status) && this.#finalRecord === undefined) {
      this.#finalRecord = this.#task.persist();
    }
  }
}

class TermflowTaskGroup implements TaskGroup {
  #tasks: GroupTask[] = [];
  #summary: readonly TaskFinalRecord[] | undefined;
  #disposed = false;
  #stream: NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
  #ansi: 'auto' | 'always' | 'never' | undefined;
  #columns: number | undefined;
  #renderMode: RenderMode;
  #spinnerFrames: readonly string[] | undefined;
  #statusSymbols: Partial<Record<TaskStatus, string>> | undefined;
  #progressBar: TaskProgressBarOptions | undefined;
  #format: TaskFormat | undefined;
  #plainOutput: PlainOutputPolicy | undefined;
  #clock: TaskClock | undefined;
  #scheduler: TaskScheduler | undefined;

  constructor(options: TaskGroupOptions) {
    const stream = options.stream === undefined ? process.stderr : options.stream;
    if (stream === null || typeof stream.write !== 'function') {
      throw new TypeError('stream must provide a write method.');
    }
    this.#stream = stream;
    assertTaskOptionValues(options);
    this.#ansi = options.ansi;
    this.#columns = resolveColumns(options.columns, this.#stream);
    this.#renderMode = options.renderMode ?? 'static';
    this.#spinnerFrames =
      options.spinnerFrames === undefined ? undefined : snapshotSpinnerFrames(options.spinnerFrames);
    this.#statusSymbols =
      options.statusSymbols === undefined ? undefined : snapshotStatusSymbols(options.statusSymbols);
    this.#progressBar =
      options.progressBar === undefined ? undefined : snapshotProgressBar(options.progressBar);
    this.#format = options.format;
    this.#plainOutput = snapshotPlainOutputPolicy(options.plainOutput);
    this.#clock = options.clock;
    this.#scheduler = options.scheduler;
  }

  get tasks(): readonly Task[] {
    return Object.freeze([...this.#tasks]);
  }

  createTask(options: TaskGroupTaskOptions): Task {
    this.#assertActive('createTask');
    if (this.#summary !== undefined) {
      throw new Error('Cannot createTask a persisted task group.');
    }
    assertTaskOptionValues(options);
    const statusSymbols =
      options.statusSymbols === undefined ? undefined : snapshotStatusSymbols(options.statusSymbols);
    const progressBar =
      options.progressBar === undefined ? undefined : snapshotProgressBar(options.progressBar);
    const task = new GroupTask(createTask({
      ...options,
      stream: this.#stream,
      ansi: this.#ansi,
      columns: this.#columns,
      renderMode: this.#taskRenderMode(),
      spinnerFrames: this.#spinnerFrames,
      statusSymbols:
        this.#statusSymbols === undefined && statusSymbols === undefined
          ? undefined
          : { ...this.#statusSymbols, ...statusSymbols },
      progressBar:
        this.#progressBar === undefined && progressBar === undefined
          ? undefined
          : { ...this.#progressBar, ...progressBar },
      format: options.format ?? this.#format,
      plainOutput: this.#plainOutput,
      clock: this.#clock,
      scheduler: this.#scheduler,
    }));
    this.#tasks.push(task);
    return task;
  }

  stop(): void {
    this.#assertActive('stop');
    for (const task of this.#tasks) {
      if (!task.disposed) {
        task.stop();
      }
    }
  }

  clear(): void {
    this.#assertActive('clear');
    for (const task of this.#tasks) {
      if (!task.disposed) {
        task.clear();
      }
    }
  }

  persist(): readonly TaskFinalRecord[] {
    this.#assertActive('persist');
    if (this.#summary !== undefined) {
      return this.#summary;
    }
    const records = this.#tasks.map((task) => task.finalRecord());
    this.#summary = Object.freeze(records);
    if (this.#renderMode !== 'silent' && this.#plainOutput !== 'silent') {
      writePlainLine(this.#stream, formatGroupSummary(records, this.#columns));
    }
    return this.#summary;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    for (const task of this.#tasks) {
      task.dispose();
    }
    this.#disposed = true;
  }

  log(record: string): void {
    this.#assertActive('log');
    if (typeof record !== 'string') {
      throw new TypeError('record must be a string.');
    }
    if (this.#renderMode === 'silent' || this.#plainOutput === 'silent') {
      return;
    }
    writePlainLine(this.#stream, formatLogLine(record, this.#columns));
  }

  #taskRenderMode(): RenderMode {
    if (this.#renderMode === 'silent') {
      return 'silent';
    }
    return this.#renderMode === 'accessible' ? 'accessible' : 'static';
  }

  #assertActive(operation: string): void {
    if (this.#disposed) {
      throw new Error(`Cannot ${operation} a disposed task group.`);
    }
  }
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status !== 'pending' && status !== 'running';
}

function formatGroupSummary(records: readonly TaskFinalRecord[], columns: number | undefined): string {
  const counts = new Map<TaskStatus, number>();
  for (const record of records) {
    counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  }
  const details = SUMMARY_STATUS_ORDER.flatMap((status) => {
    const count = counts.get(status);
    return count === undefined ? [] : [`${count} ${status}`];
  });
  return truncateVisible(
    `[group] ${records.length} tasks${details.length === 0 ? '' : `: ${details.join(', ')}`}`,
    columns,
  );
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

export function createTaskGroup(options: TaskGroupOptions = {}): TaskGroup {
  return new TermflowTaskGroup(options);
}
