import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { createTask } from '../dist/index.js';

class MemoryStream extends Writable {
  constructor() {
    super();
    this.isTTY = true;
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

  tick() {
    for (const callback of this.#callbacks.values()) {
      callback();
    }
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

test('TTY rendering redraws spinner and progress, then preserves one newline-terminated final record', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    const scheduler = new FakeScheduler();
    let now = 0;
    const task = createTask({
      message: 'Index files',
      stream,
      total: 4,
      clock: { now: () => now },
      scheduler,
    });

    task.start();
    assert.equal(stream.output, '\r\u001B[2K- Index files [----------] 0/4 (0.0s)');
    assert.equal(scheduler.activeCount, 1);

    task.setProgress(2);
    assert.equal(
      stream.output,
      '\r\u001B[2K- Index files [----------] 0/4 (0.0s)\r\u001B[2K- Index files [#####-----] 2/4 (0.0s)',
    );

    scheduler.tick();
    assert.equal(
      stream.output,
      '\r\u001B[2K- Index files [----------] 0/4 (0.0s)\r\u001B[2K- Index files [#####-----] 2/4 (0.0s)\r\u001B[2K\\ Index files [#####-----] 2/4 (0.0s)',
    );

    now = 1_250;
    task.succeed();
    assert.equal(
      stream.output,
      '\r\u001B[2K- Index files [----------] 0/4 (0.0s)\r\u001B[2K- Index files [#####-----] 2/4 (0.0s)\r\u001B[2K\\ Index files [#####-----] 2/4 (0.0s)\r\u001B[2K[success] Index files [#####-----] 2/4 (1.3s)\n',
    );
    assert.equal(scheduler.activeCount, 0);
  });
});
