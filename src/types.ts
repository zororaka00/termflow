export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'warning'
  | 'cancelled'
  | 'skipped';

export type TerminalTaskStatus = Exclude<TaskStatus, 'pending' | 'running'>;

/** Immutable snapshot retained after a task reaches a terminal status. */
export interface TaskFinalRecord {
  readonly status: TerminalTaskStatus;
  readonly message: string;
  readonly current: number;
  readonly total: number | undefined;
  readonly elapsedMs: number;
}

export type AnsiMode = 'auto' | 'always' | 'never';

export type RenderMode = 'auto' | 'interactive' | 'static' | 'accessible' | 'silent';

/** Semantic presentation slots that may be colorized when explicitly configured. */
export type ColorSlot =
  | 'running'
  | 'success'
  | 'failure'
  | 'warning'
  | 'cancelled'
  | 'skipped'
  | 'spinner'
  | 'progress'
  | 'elapsed';

/** Dependency-free built-in foreground color names. */
export type NamedColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray';

/** Structured color forms prevent raw terminal-control-sequence injection. */
export type ColorSpec =
  | NamedColor
  | { ansiSgr: number | readonly number[] }
  | { ansi256: number }
  | { rgb: { r: number; g: number; b: number } }
  | { hex: string };

/** Opt-in colors for built-in task presentation slots. Unconfigured slots stay plain. */
export type ColorTheme = Partial<Record<ColorSlot, ColorSpec>>;

/** Controls stable records emitted when a task is not rendered interactively. */
export type PlainOutputPolicy =
  | 'all'
  | 'start-and-final'
  | 'final-only'
  | 'silent'
  | { type: 'periodic'; intervalMs: number };

export interface TaskProgressBarOptions {
  complete?: string;
  remaining?: string;
  width?: number;
}

export interface TaskRenderView {
  readonly status: TaskStatus;
  readonly message: string;
  readonly current: number;
  readonly total: number | undefined;
  readonly elapsedMs: number;
  readonly spinnerFrame: string;
}

export type TaskFormat = (view: Readonly<TaskRenderView>) => string;

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
  stream?: NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
  total?: number;
  current?: number;
  /** Explicit terminal column limit. Uses stream.columns when omitted. */
  columns?: number;
  ansi?: AnsiMode;
  /** Controls terminal interaction independently from ANSI preference. */
  renderMode?: RenderMode;
  /** Explicit semantic colors. Omit to keep all task output free of color SGR sequences. */
  colors?: ColorTheme;
  /** Non-empty spinner frames used for interactive rendering. */
  spinnerFrames?: readonly string[];
  /** Optional textual symbols that replace default status labels. */
  statusSymbols?: Partial<Record<TaskStatus, string>>;
  /** ASCII-safe progress bar customization. */
  progressBar?: TaskProgressBarOptions;
  /** Formatter output is escaped and width-limited before writing. */
  format?: TaskFormat;
  /** Controls records emitted for non-interactive rendering. Defaults to 'all'. */
  plainOutput?: PlainOutputPolicy;
  /** Optional deterministic monotonic clock. Defaults to Node performance.now(). */
  clock?: TaskClock;
  /** Optional deterministic interval scheduler. */
  scheduler?: TaskScheduler;
}

/** Shared presentation options for a deterministic collection of task handles. */
export interface TaskGroupOptions {
  stream?: NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
  columns?: number;
  ansi?: AnsiMode;
  renderMode?: RenderMode;
  /** Explicit semantic colors inherited by group tasks unless a task overrides a slot. */
  colors?: ColorTheme;
  spinnerFrames?: readonly string[];
  statusSymbols?: Partial<Record<TaskStatus, string>>;
  progressBar?: TaskProgressBarOptions;
  format?: TaskFormat;
  plainOutput?: PlainOutputPolicy;
  clock?: TaskClock;
  scheduler?: TaskScheduler;
}

/** Per-task data for a task group; the stream and lifecycle mode are group-owned. */
export interface TaskGroupTaskOptions {
  message: string;
  total?: number;
  current?: number;
  /** Explicit semantic colors that override matching group color slots. */
  colors?: ColorTheme;
  statusSymbols?: Partial<Record<TaskStatus, string>>;
  progressBar?: TaskProgressBarOptions;
  format?: TaskFormat;
}

export interface Task {
  readonly status: TaskStatus;
  readonly message: string;
  readonly current: number;
  readonly total?: number;

  start(): Task;
  update(message: string): Task;
  setProgress(current: number, total?: number): Task;
  stop(): void;
  clear(): void;
  persist(): TaskFinalRecord;
  dispose(): void;
  log(record: string): void;

  succeed(message?: string): Task;
  fail(message?: string): Task;
  warn(message?: string): Task;
  cancel(message?: string): Task;
  skip(message?: string): Task;
}

export interface TaskGroup {
  readonly tasks: readonly Task[];

  createTask(options: TaskGroupTaskOptions): Task;
  stop(): void;
  clear(): void;
  persist(): readonly TaskFinalRecord[];
  dispose(): void;
  log(record: string): void;
}
