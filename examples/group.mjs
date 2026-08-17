import { createTaskGroup } from '../dist/index.js';

const group = createTaskGroup({
  stream: process.stdout,
  renderMode: 'static',
  statusSymbols: { success: 'DONE', failure: 'FAILED' },
  progressBar: { complete: '=', remaining: '.', width: 8 },
  colors: {
    running: 'cyan',
    success: 'green',
    progress: { ansi256: 214 },
    elapsed: { rgb: { r: 145, g: 180, b: 255 } },
  },
});

const download = group.createTask({ message: 'Download release', total: 1 });
const verify = group.createTask({ message: 'Verify checksum' });

download.start().setProgress(1).succeed();
verify.start().succeed();
group.persist();
