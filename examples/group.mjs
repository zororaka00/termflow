import { createTaskGroup } from '../dist/index.js';

const group = createTaskGroup({
  stream: process.stdout,
  renderMode: 'static',
  statusSymbols: { success: 'DONE', failure: 'FAILED' },
  progressBar: { complete: '=', remaining: '.', width: 8 },
});

const download = group.createTask({ message: 'Download release', total: 1 });
const verify = group.createTask({ message: 'Verify checksum' });

download.start().setProgress(1).succeed();
verify.start().succeed();
group.persist();
