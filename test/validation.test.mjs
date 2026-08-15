import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { createTask } from '../dist/index.js';

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

test('progress rejects invalid finite boundaries without changing task state', () => {
  assert.throws(
    () => createTask({ message: 'Invalid', total: -1 }),
    { name: 'RangeError', message: 'total must be a finite, non-negative number.' },
  );
  assert.throws(
    () => createTask({ message: 'Invalid', current: 2, total: 1 }),
    { name: 'RangeError', message: 'current must be less than or equal to total.' },
  );

  const stream = new MemoryStream();
  const task = createTask({ message: 'Valid', stream, total: 5, current: 1 }).start();
  const output = stream.output;

  for (const update of [
    () => task.setProgress(-1),
    () => task.setProgress(Number.NaN),
    () => task.setProgress(Number.POSITIVE_INFINITY),
    () => task.setProgress(6),
    () => task.setProgress(1, -1),
  ]) {
    assert.throws(update, RangeError);
  }

  assert.equal(task.status, 'running');
  assert.equal(task.current, 1);
  assert.equal(task.total, 5);
  assert.equal(stream.output, output);
});

test('terminal tasks reject conflicting transitions and later mutations deterministically', () => {
  const task = createTask({ message: 'Build', stream: new MemoryStream() }).succeed();

  assert.throws(
    () => task.fail(),
    { message: 'Invalid task transition: success -> failure.' },
  );
  assert.throws(
    () => task.start(),
    { message: 'Cannot start a terminal task (success).' },
  );
  assert.throws(
    () => task.update('Reopen'),
    { message: 'Cannot update a terminal task (success).' },
  );
  assert.throws(
    () => task.setProgress(1),
    { message: 'Cannot setProgress a terminal task (success).' },
  );
});
