import assert from 'node:assert/strict';
import test from 'node:test';

import { createTask } from '../dist/index.js';

test('caller-owned streams are neither closed nor destroyed when backpressure is reported', () => {
  const stream = {
    isTTY: false,
    writes: [],
    endCalls: 0,
    destroyCalls: 0,
    write(value) {
      this.writes.push(value);
      return false;
    },
    end() {
      this.endCalls += 1;
    },
    destroy() {
      this.destroyCalls += 1;
    },
  };

  createTask({ message: 'Report', stream }).start().succeed();

  assert.deepEqual(stream.writes, [
    '[running] Report (0.0s)\n',
    '[success] Report (0.0s)\n',
  ]);
  assert.equal(stream.endCalls, 0);
  assert.equal(stream.destroyCalls, 0);
});

test('synchronous caller stream write failures are not swallowed', () => {
  const stream = {
    isTTY: false,
    write() {
      throw new Error('disk full');
    },
  };

  assert.throws(
    () => createTask({ message: 'Report', stream }).start(),
    { message: 'disk full' },
  );
});
