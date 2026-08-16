import type { TaskFormat, TaskProgressBarOptions, TaskRenderView } from './types.js';

export interface RenderView extends TaskRenderView {
  statusSymbol: string | undefined;
  progressBar: TaskProgressBarOptions | undefined;
  format: TaskFormat | undefined;
  columns: number | undefined;
}

export interface Renderer {
  renderActive(view: RenderView): void;
  renderFinal(view: RenderView, clearActiveLine: boolean): void;
}
