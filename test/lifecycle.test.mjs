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

test('a running task records message and progress updates without auto-completing', () => {
  const stream = new MemoryStream();
  const task = createTask({ message: 'Download', stream, total: 10, current: 2 });

  task.start().update('Fetching').setProgress(10);

  assert.equal(task.status, 'running');
  assert.equal(task.message, 'Fetching');
  assert.equal(task.current, 10);
  assert.equal(task.total, 10);
  assert.equal(
    stream.output,
    '[running] Download [##--------] 2/10 (0.0s)\n' +
      '[running] Fetching [##--------] 2/10 (0.0s)\n' +
      '[running] Fetching [##########] 10/10 (0.0s)\n',
  );
});
