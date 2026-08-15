# termflow

A small, dependency-free TypeScript/ESM library for one terminal task at a time. It renders an ASCII spinner for interactive terminals, a fixed-width progress bar when a total is known, and safe newline-delimited records for logs, pipes, and CI.

## Requirements and installation

- Node.js `>=18`
- ESM package (`"type": "module"`)
- No runtime dependencies

```sh
npm install termflow
```

## Quick start

```ts
import { createTask } from 'termflow';

const task = createTask({ message: 'Downloading release', total: 3 });
task.start();
task.setProgress(1);
task.setProgress(3);
task.succeed('Release downloaded');
```

`createTask()` returns a `pending` task and writes nothing. Calling `start()` changes it to `running`, performs an immediate render, and returns the same task. A repeated `start()` while running is a no-op.

## API

```ts
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'warning'
  | 'cancelled'
  | 'skipped';

export type AnsiMode = 'auto' | 'always' | 'never';

export interface TaskOptions {
  message: string;
  stream?: NodeJS.WritableStream & { isTTY?: boolean };
  total?: number;
  current?: number;
  ansi?: AnsiMode;
  clock?: TaskClock;
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

export function createTask(options: TaskOptions): Task;
```

`TaskClock`, `TaskScheduler`, and `TaskTimer` are also exported for deterministic tests and specialized runtimes. Normal callers do not need them: the defaults use `Date.now()` and an unref'd Node.js interval.

### Lifecycle and validation

- `succeed`, `fail`, `warn`, `cancel`, and `skip` may transition a task from `pending` or `running`.
- Repeating the same terminal method is idempotent: it does not change the message or duplicate final output.
- A different terminal method after completion throws `Invalid task transition: <from> -> <to>.`.
- `start`, `update`, and `setProgress` reject terminal tasks and never reopen them.
- `update` and `setProgress` are allowed while pending, but do not render until the task starts.
- `current` and `total` must be finite non-negative numbers. When a total is present, `current` must be no greater than total.
- `setProgress(current, total?)` retains the previous total when `total` is omitted. Reaching `current === total` does **not** complete a task; call a terminal method explicitly.

## Rendering and ANSI modes

The default stream is `process.stderr`. Set `stream` to any writable stream you own:

```ts
const task = createTask({
  message: 'Writing report',
  stream: process.stderr,
  ansi: 'auto',
});
```

| `ansi` mode | Behavior |
| --- | --- |
| `auto` (default) | Uses an in-place TTY line only when `stream.isTTY === true` and `CI`, `NO_COLOR`, and `TERM=dumb` are absent. Otherwise it uses plain records. |
| `never` | Always uses plain newline-delimited records, including for a TTY. |
| `always` | Explicitly uses TTY-style carriage-return/ANSI clearing and spinner animation even for a non-TTY stream or when CI/`NO_COLOR`/`TERM=dumb` is present. Use only when the output consumer accepts ANSI controls. |

Interactive output starts immediately and uses the ASCII frames `-`, `\`, `|`, and `/` at an 80 ms interval. It redraws one active line with `\r` and `ESC[2K`. A terminal transition stops the interval, clears/replaces that line, and writes one persistent newline-terminated final record.

Plain mode never animates, writes no ANSI controls, and never starts a spinner timer. `start`, running `update`, and running `setProgress` each emit a readable record. Final records are always newline-terminated. Progress uses a ten-column ASCII bar, for example `[####------] 4/10`.

Elapsed time is formatted as non-localized seconds with one decimal place, for example `(1.3s)`. It is measured from `start()` until the final render. A terminal task completed while pending has `(0.0s)`.

## Stream, timing, and safety semantics

termflow writes to, but never ends, destroys, closes, or otherwise takes ownership of the configured stream. It does not spawn commands, access the network, evaluate dynamic code, or install signal/log handlers.

Writes are immediate and synchronous from termflow's perspective: a `false` backpressure return value is not buffered or retried, and a synchronous stream `write()` exception is allowed to propagate to the caller rather than being silently hidden. The library does not attach an error listener to a caller-owned stream.

For safe one-line records, terminal control characters in rendered messages are escaped (for example, newline becomes `\\n` and escape becomes `\\x1b`). The public `task.message` keeps the original string.

## Limitations and deferred features

This MVP deliberately supports exactly one task instance and does **not** implement concurrent or nested task groups, ETA/remaining-time estimation, custom layouts or columns, themes, log buffering/interception, resize handling, JSON event output, full-screen or multi-region TUI behavior, logging frameworks, process management, command execution, AI/agents, networking, databases, scheduling, file watching, plugins, or structured-event pipelines.

It is a small display primitive, not a terminal emulator, TUI framework, logger, command runner, process manager, or replacement for application-level logging.

## License

[MIT](./LICENSE)
