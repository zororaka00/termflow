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

test('createTask creates a pending task without starting output', () => {
  const stream = new MemoryStream();
  const task = createTask({ message: 'Prepare workspace', stream });

  assert.equal(task.status, 'pending');
  assert.equal(task.message, 'Prepare workspace');
  assert.equal(task.current, 0);
  assert.equal(task.total, undefined);
  assert.equal(stream.output, '');
});

test('start transitions a plain task once and writes one stable record', () => {
  const stream = new MemoryStream();
  const task = createTask({ message: 'Prepare workspace', stream });

  assert.equal(task.start(), task);
  assert.equal(task.start(), task);
  assert.equal(task.status, 'running');
  assert.equal(stream.output, '[running] Prepare workspace (0.0s)\n');
});

test('succeed completes a pending task with one persistent final record', () => {
  const stream = new MemoryStream();
  const task = createTask({ message: 'Prepare workspace', stream });

  assert.equal(task.succeed('Ready'), task);
  assert.equal(task.status, 'success');
  assert.equal(task.message, 'Ready');
  assert.equal(stream.output, '[success] Ready (0.0s)\n');

  assert.equal(task.succeed('Ignored'), task);
  assert.equal(task.message, 'Ready');
  assert.equal(stream.output, '[success] Ready (0.0s)\n');
});

test('each non-success terminal method writes its matching final status', () => {
  const cases = [
    ['fail', 'failure'],
    ['warn', 'warning'],
    ['cancel', 'cancelled'],
    ['skip', 'skipped'],
  ];

  for (const [method, status] of cases) {
    const stream = new MemoryStream();
    const task = createTask({ message: 'Work', stream });
    task[method]('Final');

    assert.equal(task.status, status);
    assert.equal(stream.output, `[${status}] Final (0.0s)\n`);

    task[method]('Ignored');
    assert.equal(task.message, 'Final');
    assert.equal(stream.output, `[${status}] Final (0.0s)\n`);
  }
});
