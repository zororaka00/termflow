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

test('rendered messages escape terminal control characters while preserving the public message value', () => {
  const message = 'line one\nline two\u001B[2J';
  const stream = new MemoryStream();
  const task = createTask({ message, stream }).succeed();

  assert.equal(task.message, message);
  assert.equal(stream.output, '[success] line one\\nline two\\x1b[2J (0.0s)\n');
  assert.equal(stream.output.includes('\u001B'), false);
  assert.equal(stream.output.split('\n').length, 2);
});
