import { createTask } from '../dist/index.js';

const task = createTask({
  message: 'Package release',
  stream: process.stdout,
  renderMode: 'static',
  plainOutput: 'start-and-final',
  columns: process.stdout.columns,
  colors: {
    running: 'cyan',
    success: 'green',
    progress: { ansi256: 214 },
    elapsed: { rgb: { r: 145, g: 180, b: 255 } },
  },
});

task.start();
task.log('Collected package files');
task.setProgress(1, 1);
task.succeed('Release package ready');
