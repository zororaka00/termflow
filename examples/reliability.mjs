import { createTask } from '../dist/index.js';

const task = createTask({
  message: 'Package release',
  stream: process.stdout,
  renderMode: 'static',
  plainOutput: 'start-and-final',
  columns: process.stdout.columns,
});

task.start();
task.log('Collected package files');
task.setProgress(1, 1);
task.succeed('Release package ready');
