import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { createTask } from '../dist/index.js';

class MemoryStream extends Writable {
  constructor({ isTTY = false } = {}) {
    super();
    this.isTTY = isTTY;
    this.output = '';
  }

  _write(chunk, _encoding, callback) {
    this.output += chunk.toString();
    callback();
  }
}

class FakeScheduler {
  #callbacks = new Map();
  #nextId = 1;
  #delays = [];

  setInterval(callback, delayMs) {
    const handle = { id: this.#nextId++ };
    this.#callbacks.set(handle, callback);
    this.#delays.push(delayMs);
    return handle;
  }

  clearInterval(handle) {
    this.#callbacks.delete(handle);
  }

  tick() {
    for (const callback of this.#callbacks.values()) {
      callback();
    }
  }

  get activeCount() {
    return this.#callbacks.size;
  }

  get delays() {
    return this.#delays;
  }
}

function withEnvironment(values, callback) {
  const keys = ['CI', 'NO_COLOR', 'TERM'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (values[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = values[key];
      }
    }
    callback();
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

test('the default elapsed clock does not call the wall clock', () => {
  const originalDateNow = Date.now;
  Date.now = () => {
    throw new Error('wall clock must not be used');
  };

  try {
    const stream = new MemoryStream();
    createTask({ message: 'Measure elapsed time', stream }).start().succeed();
    assert.match(stream.output, /^\[running\] Measure elapsed time \(0\.0s\)\n\[success\]/);
  } finally {
    Date.now = originalDateNow;
  }
});

test('the start-and-final plain policy suppresses intermediate updates', () => {
  const stream = new MemoryStream();
  const task = createTask({
    message: 'Upload artifact',
    stream,
    total: 2,
    plainOutput: 'start-and-final',
  });

  task.start().update('Uploading artifact').setProgress(1).succeed('Artifact uploaded');

  assert.equal(
    stream.output,
    '[running] Upload artifact [----------] 0/2 (0.0s)\n' +
      '[success] Artifact uploaded [#####-----] 1/2 (0.0s)\n',
  );
});

test('the final-only plain policy emits only a terminal record', () => {
  const stream = new MemoryStream();
  const task = createTask({
    message: 'Archive artifacts',
    stream,
    plainOutput: 'final-only',
  });

  task.start().update('Archiving artifacts').succeed();

  assert.equal(stream.output, '[success] Archiving artifacts (0.0s)\n');
});

test('the silent plain policy emits no task records', () => {
  const stream = new MemoryStream();
  const task = createTask({
    message: 'Remove temporary files',
    stream,
    plainOutput: 'silent',
  });

  task.start().update('Removing files').succeed();

  assert.equal(stream.output, '');
});

test('silent render mode does not schedule periodic plain-output work', () => {
  const stream = new MemoryStream();
  const scheduler = new FakeScheduler();
  const task = createTask({
    message: 'Quiet periodic task',
    stream,
    renderMode: 'silent',
    plainOutput: { type: 'periodic', intervalMs: 1_000 },
    scheduler,
  });

  task.start();

  assert.equal(scheduler.activeCount, 0);
  assert.equal(stream.output, '');
});

test('the periodic plain policy emits a changed task on its injected interval', () => {
  let now = 0;
  const stream = new MemoryStream();
  const scheduler = new FakeScheduler();
  const task = createTask({
    message: 'Copy source',
    stream,
    clock: { now: () => now },
    scheduler,
    plainOutput: { type: 'periodic', intervalMs: 1_000 },
  });

  task.start().update('Copy destination');
  assert.equal(scheduler.activeCount, 1);
  assert.equal(stream.output, '[running] Copy source (0.0s)\n');

  now = 1_000;
  scheduler.tick();

  assert.equal(
    stream.output,
    '[running] Copy source (0.0s)\n[running] Copy destination (1.0s)\n',
  );
});

test('a periodic plain-output policy snapshots its validated interval', () => {
  const stream = new MemoryStream();
  const scheduler = new FakeScheduler();
  const plainOutput = { type: 'periodic', intervalMs: 1_000 };
  const task = createTask({ message: 'Snapshot interval', stream, scheduler, plainOutput });

  plainOutput.intervalMs = 0;
  task.start();

  assert.deepEqual(scheduler.delays, [1_000]);
});

test('stop cancels automatic interactive redraws without changing task state', () => {
  const stream = new MemoryStream({ isTTY: true });
  const scheduler = new FakeScheduler();
  const task = createTask({ message: 'Wait for service', stream, scheduler });

  task.start();
  task.stop();
  task.stop();

  assert.equal(task.status, 'running');
  assert.equal(scheduler.activeCount, 0);
});

test('clear erases only the active interactive line without stopping the scheduler', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream({ isTTY: true });
    const scheduler = new FakeScheduler();
    const task = createTask({ message: 'Check health', stream, scheduler });

    task.start();
    task.clear();
    const outputAfterFirstClear = stream.output;
    task.clear();

    assert.equal(outputAfterFirstClear, '\r\u001B[2K- Check health (0.0s)\r\u001B[2K');
    assert.equal(stream.output, outputAfterFirstClear);
    assert.equal(scheduler.activeCount, 1);
    assert.equal(task.status, 'running');
  });
});

test('a pending task completed with forced ANSI does not clear caller-owned output', () => {
  const stream = new MemoryStream({ isTTY: false });

  createTask({ message: 'Complete immediately', stream, ansi: 'always' }).succeed();

  assert.equal(stream.output, '[success] Complete immediately (0.0s)\n');
  assert.equal(stream.output.includes('\r'), false);
  assert.equal(stream.output.includes('\u001B'), false);
});

test('persist returns the one terminal record without writing it twice', () => {
  const stream = new MemoryStream();
  const task = createTask({ message: 'Store report', stream }).succeed('Report stored');

  const firstRecord = task.persist();
  const secondRecord = task.persist();

  assert.deepEqual(firstRecord, {
    status: 'success',
    message: 'Report stored',
    current: 0,
    total: undefined,
    elapsedMs: 0,
  });
  assert.equal(secondRecord, firstRecord);
  assert.equal(stream.output, '[success] Report stored (0.0s)\n');
});

test('dispose releases renderer scheduling and rejects later task operations', () => {
  const stream = new MemoryStream({ isTTY: true });
  const scheduler = new FakeScheduler();
  const task = createTask({ message: 'Release resources', stream, scheduler });

  task.start();
  task.dispose();
  task.dispose();

  assert.equal(scheduler.activeCount, 0);
  assert.equal(task.status, 'running');
  assert.throws(() => task.update('Retry'), {
    message: 'Cannot update a disposed task.',
  });
});

test('log clears and restores only an active interactive task line', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream({ isTTY: true });
    const task = createTask({ message: 'Build package', stream });

    task.start();
    task.log('compiler started\nwatching source');

    assert.equal(
      stream.output,
      '\r\u001B[2K- Build package (0.0s)' +
        '\r\u001B[2K[log] compiler started\\nwatching source\n' +
        '\r\u001B[2K- Build package (0.0s)',
    );
  });
});

test('known terminal columns bound the visible width of plain task records', () => {
  const stream = new MemoryStream();
  createTask({
    message: 'A deliberately long task message that must not wrap the terminal line',
    stream,
    columns: 20,
  }).start();

  const line = stream.output.trimEnd();
  assert.ok(Array.from(line).length <= 20);
  assert.match(line, /^\[running\]/);
  assert.match(line, /…$/);
});

test('static mode ignores forced ANSI and emits stable records on a TTY', () => {
  const stream = new MemoryStream({ isTTY: true });
  createTask({
    message: 'Generate documentation',
    stream,
    ansi: 'always',
    renderMode: 'static',
  }).start().succeed();

  assert.equal(
    stream.output,
    '[running] Generate documentation (0.0s)\n[success] Generate documentation (0.0s)\n',
  );
});

test('custom spinner frames render deterministically for interactive tasks', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream({ isTTY: true });
    const scheduler = new FakeScheduler();
    createTask({
      message: 'Synchronize registry',
      stream,
      scheduler,
      spinnerFrames: ['.'],
    }).start();

    assert.equal(stream.output, '\r\u001B[2K. Synchronize registry (0.0s)');
  });
});

test('custom status symbols remain visible with ANSI disabled', () => {
  const stream = new MemoryStream();
  createTask({
    message: 'Publish report',
    stream,
    ansi: 'never',
    statusSymbols: { success: 'OK' },
  }).succeed();

  assert.equal(stream.output, '[OK] Publish report (0.0s)\n');
});

test('custom progress bar characters and width render in stable output', () => {
  const stream = new MemoryStream();
  createTask({
    message: 'Write archive',
    stream,
    current: 1,
    total: 2,
    progressBar: { complete: '=', remaining: '.', width: 4 },
  }).start();

  assert.equal(stream.output, '[running] Write archive [==..] 1/2 (0.0s)\n');
});

test('visual customization is snapshotted instead of retaining caller-owned option objects', () => {
  const stream = new MemoryStream();
  const statusSymbols = { success: 'DONE' };
  const progressBar = { complete: '=', remaining: '.', width: 4 };
  const task = createTask({
    message: 'Snapshot styles',
    stream,
    current: 1,
    total: 2,
    statusSymbols,
    progressBar,
  });

  statusSymbols.success = 'BROKEN';
  progressBar.complete = '*';
  progressBar.width = 1;
  task.succeed();

  assert.equal(stream.output, '[DONE] Snapshot styles [==..] 1/2 (0.0s)\n');
});

test('visual customization rejects terminal control characters before rendering', () => {
  const stream = new MemoryStream();

  assert.throws(
    () => createTask({ message: 'Safe output', stream, spinnerFrames: ['\n'] }),
    /spinnerFrames must be a non-empty array of terminal-control-free strings/,
  );
  assert.throws(
    () => createTask({ message: 'Safe output', stream, statusSymbols: { success: '\u001B' } }),
    /statusSymbols must map task statuses to non-empty, terminal-control-free strings/,
  );
  assert.throws(
    () =>
      createTask({ message: 'Safe output', stream, progressBar: { complete: '\r', width: 1 } }),
    /progressBar complete and remaining must be non-empty, terminal-control-free strings/,
  );
});

test('stateful customization getters cannot bypass terminal-control validation', () => {
  let reads = 0;
  const statusSymbols = {};
  Object.defineProperty(statusSymbols, 'success', {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? 'OK' : '\u001B[2J';
    },
  });

  assert.throws(
    () => createTask({ message: 'Stateful symbols', statusSymbols }),
    /statusSymbols must map task statuses to non-empty, terminal-control-free strings/,
  );
});

test('sparse spinner frame arrays are rejected before rendering', () => {
  assert.throws(
    () => createTask({ message: 'Sparse frames', spinnerFrames: [, 'done'] }),
    /spinnerFrames must be a non-empty array of terminal-control-free strings/,
  );
});

test('format callbacks receive a read-only task view and produce sanitized output', () => {
  const stream = new MemoryStream();
  createTask({
    message: 'Create index',
    stream,
    format: (view) => `${view.status}: ${view.message}\ntrusted`,
  }).succeed();

  assert.equal(stream.output, 'success: Create index\\ntrusted\n');
});

test('explicit null current and stream values are rejected instead of defaulted', () => {
  assert.throws(
    () => createTask({ message: 'Invalid current', current: null }),
    /current must be a finite, non-negative number/,
  );
  assert.throws(
    () => createTask({ message: 'Invalid stream', stream: null }),
    /stream must provide a write method/,
  );
});
