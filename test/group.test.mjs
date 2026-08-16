import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { createTaskGroup } from '../dist/index.js';

class MemoryStream extends Writable {
  constructor() {
    super();
    this.isTTY = false;
    this.output = '';
  }

  _write(chunk, _encoding, callback) {
    this.output += chunk.toString();
    callback();
  }
}

test('a group keeps concurrently active tasks and their terminal outcomes isolated', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({ stream, renderMode: 'static', clock: { now: () => 0 } });
  const download = group.createTask({ message: 'Download release' });
  const verify = group.createTask({ message: 'Verify checksum' });

  download.start();
  verify.start();
  download.succeed('Release downloaded');
  verify.fail('Checksum mismatch');

  assert.equal(download.status, 'success');
  assert.equal(verify.status, 'failure');
  assert.deepEqual(group.persist(), [
    {
      status: 'success',
      message: 'Release downloaded',
      current: 0,
      total: undefined,
      elapsedMs: 0,
    },
    {
      status: 'failure',
      message: 'Checksum mismatch',
      current: 0,
      total: undefined,
      elapsedMs: 0,
    },
  ]);
  assert.equal(
    stream.output,
    '[running] Download release (0.0s)\n' +
      '[running] Verify checksum (0.0s)\n' +
      '[success] Release downloaded (0.0s)\n' +
      '[failure] Checksum mismatch (0.0s)\n' +
      '[group] 2 tasks: 1 success, 1 failure\n',
  );
});

test('group-level visual customization is inherited by every group task', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({
    stream,
    renderMode: 'static',
    clock: { now: () => 0 },
    statusSymbols: { success: 'DONE' },
    progressBar: { complete: '=', remaining: '.', width: 2 },
  });
  const task = group.createTask({ message: 'Upload bundle', current: 1, total: 2 });

  task.start().succeed();

  assert.equal(
    stream.output,
    '[running] Upload bundle [=.] 1/2 (0.0s)\n[DONE] Upload bundle [=.] 1/2 (0.0s)\n',
  );
});

test('a group exposes an immutable task collection in creation order', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({ stream });
  const first = group.createTask({ message: 'First task' });
  const second = group.createTask({ message: 'Second task' });

  assert.deepEqual(group.tasks, [first, second]);
  assert.throws(() => group.tasks.pop(), TypeError);
  assert.deepEqual(group.tasks, [first, second]);
});

test('a group summary respects the configured terminal width', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({
    stream,
    columns: 20,
    renderMode: 'static',
    clock: { now: () => 0 },
  });

  group.createTask({ message: 'One' }).succeed();
  group.persist();

  const summary = stream.output.trimEnd().split('\n').at(-1);
  assert.match(summary, /^\[group\]/);
  assert.ok(Array.from(summary).length <= 20);
});

test('a group summary uses available stream columns when no explicit width is supplied', () => {
  const stream = new MemoryStream();
  stream.columns = 20;
  const group = createTaskGroup({ stream, renderMode: 'static', clock: { now: () => 0 } });

  group.createTask({ message: 'One' }).succeed();
  group.persist();

  const summary = stream.output.trimEnd().split('\n').at(-1);
  assert.match(summary, /^\[group\]/);
  assert.ok(Array.from(summary).length <= 20);
});

test('a group task can override group visual customization without changing siblings', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({
    stream,
    renderMode: 'static',
    clock: { now: () => 0 },
    statusSymbols: { success: 'GROUP' },
    progressBar: { complete: '=', remaining: '.', width: 2 },
  });
  const overridden = group.createTask({
    message: 'Custom task',
    current: 1,
    total: 2,
    statusSymbols: { success: 'TASK' },
    progressBar: { complete: '+', remaining: '.', width: 4 },
  });
  const inherited = group.createTask({ message: 'Inherited task', current: 1, total: 2 });

  overridden.succeed();
  inherited.succeed();

  assert.equal(
    stream.output,
    '[TASK] Custom task [++..] 1/2 (0.0s)\n[GROUP] Inherited task [=.] 1/2 (0.0s)\n',
  );
});

test('a group snapshots visual defaults before tasks are created', () => {
  const stream = new MemoryStream();
  const statusSymbols = { success: 'DONE' };
  const progressBar = { complete: '=', remaining: '.', width: 4 };
  const group = createTaskGroup({
    stream,
    renderMode: 'static',
    clock: { now: () => 0 },
    statusSymbols,
    progressBar,
  });

  statusSymbols.success = 'BROKEN';
  progressBar.complete = '*';
  progressBar.width = 1;
  group.createTask({ message: 'Group snapshot', current: 1, total: 2 }).succeed();

  assert.equal(stream.output, '[DONE] Group snapshot [==..] 1/2 (0.0s)\n');
});

test('a group snapshots its validated periodic plain-output policy', () => {
  const stream = new MemoryStream();
  const plainOutput = { type: 'periodic', intervalMs: 1_000 };
  const group = createTaskGroup({ stream, plainOutput });

  plainOutput.intervalMs = 0;

  assert.doesNotThrow(() => group.createTask({ message: 'Periodic child' }));
});

test('groups keep logs stable on a TTY even when ANSI is forced', () => {
  const stream = new MemoryStream();
  stream.isTTY = true;
  const group = createTaskGroup({
    stream,
    ansi: 'always',
    clock: { now: () => 0 },
  });
  const task = group.createTask({ message: 'Build index' });

  task.start();
  group.log('compiler started\nwatching source');
  task.succeed();

  assert.equal(
    stream.output,
    '[running] Build index (0.0s)\n' +
      '[log] compiler started\\nwatching source\n' +
      '[success] Build index (0.0s)\n',
  );
  assert.equal(stream.output.includes('\r'), false);
  assert.equal(stream.output.includes('\u001B'), false);
});

test('silent groups preserve final records while cleanup and persistence remain idempotent', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({ stream, renderMode: 'silent', clock: { now: () => 0 } });
  const task = group.createTask({ message: 'Quiet task' }).succeed();
  const expectedRecord = task.persist();

  const firstRecords = group.persist();
  const secondRecords = group.persist();
  group.stop();
  group.clear();
  group.dispose();
  group.dispose();

  assert.deepEqual(firstRecords, [expectedRecord]);
  assert.equal(secondRecords, firstRecords);
  assert.equal(stream.output, '');
  assert.throws(() => group.createTask({ message: 'Later task' }), /disposed task group/);
});

test('a persisted group rejects new tasks so its final summary cannot become stale', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({ stream, renderMode: 'static', clock: { now: () => 0 } });

  group.createTask({ message: 'First task' }).succeed();
  const records = group.persist();

  assert.throws(() => group.createTask({ message: 'Later task' }), /persisted task group/);
  assert.equal(group.persist(), records);
  assert.equal(stream.output, '[success] First task (0.0s)\n[group] 1 tasks: 1 success\n');
});

test('a group can clean up and summarize a terminal child disposed independently', () => {
  const stream = new MemoryStream();
  const group = createTaskGroup({ stream, renderMode: 'static', clock: { now: () => 0 } });
  const task = group.createTask({ message: 'Disposed child' }).succeed();
  task.dispose();

  assert.doesNotThrow(() => group.stop());
  assert.doesNotThrow(() => group.clear());
  assert.deepEqual(group.persist(), [
    {
      status: 'success',
      message: 'Disposed child',
      current: 0,
      total: undefined,
      elapsedMs: 0,
    },
  ]);
  assert.equal(stream.output, '[success] Disposed child (0.0s)\n[group] 1 tasks: 1 success\n');
});

test('a group rejects invalid render modes before creating task handles', () => {
  assert.throws(
    () => createTaskGroup({ renderMode: 'unsupported' }),
    /renderMode must be "auto", "interactive", "static", "accessible", or "silent"/,
  );
  assert.throws(
    () => createTaskGroup({ renderMode: null }),
    /renderMode must be "auto", "interactive", "static", "accessible", or "silent"/,
  );
});

test('a group eagerly validates shared output options before creating task handles', () => {
  assert.throws(
    () => createTaskGroup({ ansi: 'unsupported' }),
    /ansi must be "auto", "always", or "never"/,
  );
  assert.throws(
    () => createTaskGroup({ plainOutput: { type: 'periodic', intervalMs: 0 } }),
    /plainOutput must be "all", "start-and-final", "final-only", "silent", or a periodic policy/,
  );
  assert.throws(
    () => createTaskGroup({ spinnerFrames: [] }),
    /spinnerFrames must be a non-empty array of terminal-control-free strings/,
  );
  assert.throws(
    () => createTaskGroup({ stream: null }),
    /stream must provide a write method/,
  );
});

test('a group rejects invalid per-task visual overrides before merging defaults', () => {
  const group = createTaskGroup();

  assert.throws(
    () => group.createTask({ message: 'Bad symbols', statusSymbols: null }),
    /statusSymbols must map task statuses to non-empty, terminal-control-free strings/,
  );
  assert.throws(
    () => group.createTask({ message: 'Bad progress', progressBar: 0 }),
    /progressBar must be an object/,
  );
  assert.throws(
    () => group.createTask({ message: 'Bad format', format: 'not a function' }),
    /format must be a function/,
  );
});
