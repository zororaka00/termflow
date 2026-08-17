import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { createTask, createTaskGroup } from '../dist/index.js';

class MemoryStream extends Writable {
  constructor(isTTY = false) {
    super();
    this.isTTY = isTTY;
    this.output = '';
  }

  _write(chunk, _encoding, callback) {
    this.output += chunk.toString();
    callback();
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

test('explicit named status colors wrap only configured semantic slots', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    const task = createTask({
      message: 'Build',
      stream,
      ansi: 'always',
      renderMode: 'static',
      colors: { success: 'green' },
      clock: { now: () => 0 },
    });

    task.start().succeed();

    assert.equal(
      stream.output,
      '[running] Build (0.0s)\n\u001B[32m[success]\u001B[0m Build (0.0s)\n',
    );
  });
});

test('a hex color renders a deterministic truecolor failure status', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    createTask({
      message: 'Build',
      stream,
      ansi: 'always',
      renderMode: 'static',
      colors: { failure: { hex: '#E05252' } },
      clock: { now: () => 0 },
    }).fail();

    assert.equal(
      stream.output,
      '\u001B[38;2;224;82;82m[failure]\u001B[0m Build (0.0s)\n',
    );
  });
});

test('structured colors style the configured interactive spinner, progress, and elapsed slots', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream(true);
    createTask({
      message: 'Build',
      current: 1,
      total: 2,
      stream,
      colors: {
        spinner: { ansiSgr: [1, 36] },
        progress: { ansi256: 214 },
        elapsed: { rgb: { r: 1, g: 2, b: 3 } },
      },
      clock: { now: () => 0 },
    }).start();

    assert.equal(
      stream.output,
      '\r\u001B[2K\u001B[1;36m-\u001B[0m Build \u001B[38;5;214m[#####-----] 1/2\u001B[0m \u001B[38;2;1;2;3m(0.0s)\u001B[0m',
    );
  });
});

test('group colors are inherited and a task color override remains isolated', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    const group = createTaskGroup({
      stream,
      ansi: 'always',
      renderMode: 'static',
      colors: { running: 'cyan', success: 'green' },
      clock: { now: () => 0 },
    });
    const overridden = group.createTask({
      message: 'Override',
      colors: { success: 'yellow' },
    });
    const inherited = group.createTask({ message: 'Inherited' });

    overridden.start().succeed();
    inherited.start().succeed();

    assert.equal(
      stream.output,
      '\u001B[36m[running]\u001B[0m Override (0.0s)\n' +
        '\u001B[33m[success]\u001B[0m Override (0.0s)\n' +
        '\u001B[36m[running]\u001B[0m Inherited (0.0s)\n' +
        '\u001B[32m[success]\u001B[0m Inherited (0.0s)\n',
    );
  });
});

test('color-aware truncation preserves a complete reset before the ellipsis', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    createTask({
      message: 'Long message',
      stream,
      ansi: 'always',
      renderMode: 'static',
      columns: 11,
      colors: { success: 'green' },
      clock: { now: () => 0 },
    }).succeed();

    assert.equal(stream.output, '\u001B[32m[success]\u001B[0m …\n');
  });
});

test('color output requires an explicit theme and respects NO_COLOR and ANSI policy', () => {
  withEnvironment({}, () => {
    const unconfigured = new MemoryStream(false);
    createTask({
      message: 'Unconfigured',
      stream: unconfigured,
      ansi: 'always',
      renderMode: 'static',
      clock: { now: () => 0 },
    }).succeed();
    assert.equal(unconfigured.output, '[success] Unconfigured (0.0s)\n');

    const autoNonTty = new MemoryStream(false);
    createTask({
      message: 'Non-TTY',
      stream: autoNonTty,
      colors: { success: 'green' },
      clock: { now: () => 0 },
    }).succeed();
    assert.equal(autoNonTty.output, '[success] Non-TTY (0.0s)\n');

    const never = new MemoryStream(true);
    createTask({
      message: 'Never',
      stream: never,
      ansi: 'never',
      colors: { success: 'green' },
      clock: { now: () => 0 },
    }).succeed();
    assert.equal(never.output, '[success] Never (0.0s)\n');
  });

  withEnvironment({ NO_COLOR: '' }, () => {
    const stream = new MemoryStream(false);
    createTask({
      message: 'Suppressed',
      stream,
      ansi: 'always',
      renderMode: 'static',
      colors: { success: 'green' },
      clock: { now: () => 0 },
    }).succeed();
    assert.equal(stream.output, '[success] Suppressed (0.0s)\n');
  });

  withEnvironment({ CI: 'true' }, () => {
    const stream = new MemoryStream(true);
    createTask({
      message: 'CI',
      stream,
      renderMode: 'static',
      colors: { success: 'green' },
      clock: { now: () => 0 },
    }).succeed();
    assert.equal(stream.output, '[success] CI (0.0s)\n');
  });
});

test('invalid color forms reject unsafe terminal control input and invalid ranges', () => {
  const invalidOptions = [
    { colors: null, error: /colors must be an object/ },
    { colors: { success: '\u001B[2J' }, error: /supported named color/ },
    { colors: { success: { ansiSgr: [38] } }, error: /supported integer color or style SGR/ },
    { colors: { success: { ansi256: 256 } }, error: /integer between 0 and 255/ },
    { colors: { success: { rgb: { r: -1, g: 0, b: 0 } } }, error: /integer between 0 and 255/ },
    { colors: { success: { hex: '#fff' } }, error: /six-digit #RRGGBB/ },
    { colors: { unsafe: 'red' }, error: /Unsupported color slot/ },
  ];

  for (const { colors, error } of invalidOptions) {
    assert.throws(() => createTask({ message: 'Invalid', colors }), error);
  }
});

test('a completed colored record resets before subsequent caller output', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    createTask({
      message: 'Build',
      stream,
      ansi: 'always',
      renderMode: 'static',
      colors: { success: { ansiSgr: [1, 32] } },
      clock: { now: () => 0 },
    }).succeed();
    stream.write('caller output\n');

    assert.equal(
      stream.output,
      '\u001B[1;32m[success]\u001B[0m Build (0.0s)\ncaller output\n',
    );
  });
});

test('the reliability example emits opt-in semantic colors for status, progress, and elapsed slots', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    const task = createTask({
      message: 'Package release',
      stream,
      renderMode: 'static',
      plainOutput: 'start-and-final',
      ansi: 'always',
      colors: {
        running: 'cyan',
        success: 'green',
        progress: { ansi256: 214 },
        elapsed: { rgb: { r: 145, g: 180, b: 255 } },
      },
      clock: { now: () => 0 },
    });

    task.start();
    task.log('Collected package files');
    task.setProgress(1, 1);
    task.succeed('Release package ready');

    assert.equal(
      stream.output,
      '\u001B[36m[running]\u001B[0m Package release \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n' +
        '[log] Collected package files\n' +
        '\u001B[32m[success]\u001B[0m Release package ready \u001B[38;5;214m[##########] 1/1\u001B[0m \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n',
    );
  });
});

test('the group example inherits semantic colors and custom status symbols', () => {
  withEnvironment({}, () => {
    const stream = new MemoryStream();
    const group = createTaskGroup({
      stream,
      renderMode: 'static',
      ansi: 'always',
      statusSymbols: { success: 'DONE', failure: 'FAILED' },
      progressBar: { complete: '=', remaining: '.', width: 8 },
      colors: {
        running: 'cyan',
        success: 'green',
        progress: { ansi256: 214 },
        elapsed: { rgb: { r: 145, g: 180, b: 255 } },
      },
      clock: { now: () => 0 },
    });

    const download = group.createTask({ message: 'Download release', total: 1 });
    const verify = group.createTask({ message: 'Verify checksum' });

    download.start().setProgress(1).succeed();
    verify.start().succeed();
    group.persist();

    assert.equal(
      stream.output,
      '\u001B[36m[running]\u001B[0m Download release \u001B[38;5;214m[........] 0/1\u001B[0m \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n' +
        '\u001B[36m[running]\u001B[0m Download release \u001B[38;5;214m[========] 1/1\u001B[0m \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n' +
        '\u001B[32m[DONE]\u001B[0m Download release \u001B[38;5;214m[========] 1/1\u001B[0m \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n' +
        '\u001B[36m[running]\u001B[0m Verify checksum \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n' +
        '\u001B[32m[DONE]\u001B[0m Verify checksum \u001B[38;2;145;180;255m(0.0s)\u001B[0m\n' +
        '[group] 2 tasks: 2 success\n',
    );
  });
});
