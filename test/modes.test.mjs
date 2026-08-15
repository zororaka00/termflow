import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { createTask } from '../dist/index.js';

class MemoryStream extends Writable {
  constructor(isTTY) {
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

  setInterval(callback) {
    const handle = { id: this.#nextId++ };
    this.#callbacks.set(handle, callback);
    return handle;
  }

  clearInterval(handle) {
    this.#callbacks.delete(handle);
  }

  get activeCount() {
    return this.#callbacks.size;
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

test('auto mode uses stable plain output without timers for non-interactive and restricted environments', () => {
  for (const scenario of [
    { isTTY: false, environment: {} },
    { isTTY: true, environment: { CI: 'true' } },
    { isTTY: true, environment: { NO_COLOR: '' } },
    { isTTY: true, environment: { TERM: 'dumb' } },
  ]) {
    withEnvironment(scenario.environment, () => {
      const stream = new MemoryStream(scenario.isTTY);
      const scheduler = new FakeScheduler();
      const task = createTask({
        message: 'Build',
        stream,
        scheduler,
        clock: { now: () => 0 },
      });

      task.start().succeed();
      assert.equal(scheduler.activeCount, 0);
      assert.equal(stream.output.includes('\u001B'), false);
      assert.equal(stream.output.includes('\r'), false);
      assert.equal(stream.output, '[running] Build (0.0s)\n[success] Build (0.0s)\n');
    });
  }
});

test('never forces plain output on a TTY while always explicitly uses in-place ANSI on a non-TTY', () => {
  withEnvironment({}, () => {
    const plainStream = new MemoryStream(true);
    const plainScheduler = new FakeScheduler();
    createTask({
      message: 'Plain',
      stream: plainStream,
      ansi: 'never',
      scheduler: plainScheduler,
      clock: { now: () => 0 },
    }).start();
    assert.equal(plainStream.output, '[running] Plain (0.0s)\n');
    assert.equal(plainScheduler.activeCount, 0);

    const ansiStream = new MemoryStream(false);
    const ansiScheduler = new FakeScheduler();
    createTask({
      message: 'Forced',
      stream: ansiStream,
      ansi: 'always',
      scheduler: ansiScheduler,
      clock: { now: () => 0 },
    }).start();
    assert.equal(ansiStream.output, '\r\u001B[2K- Forced (0.0s)');
    assert.equal(ansiScheduler.activeCount, 1);
  });
});
