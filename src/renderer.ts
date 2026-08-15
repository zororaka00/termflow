import type { TaskStatus } from './types.js';

export interface RenderView {
  status: TaskStatus;
  message: string;
  current: number;
  total: number | undefined;
  elapsedMs: number;
  spinnerFrame: string;
}

export interface Renderer {
  renderActive(view: RenderView): void;
  renderFinal(view: RenderView): void;
}
