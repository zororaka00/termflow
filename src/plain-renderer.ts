import { formatElapsed } from './elapsed.js';
import { formatProgress } from './progress.js';
import type { Renderer, RenderView } from './renderer.js';
import type { TaskStatus } from './types.js';

export function formatTaskDetails(
  message: string,
  current: number,
  total: number | undefined,
  elapsedMs: number,
): string {
  const progress = total === undefined ? '' : ` ${formatProgress(current, total)}`;
  return `${escapeTerminalControls(message)}${progress} (${formatElapsed(elapsedMs)})`;
}

function escapeTerminalControls(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, (character) => {
    switch (character) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\x${character.codePointAt(0)?.toString(16).padStart(2, '0')}`;
    }
  });
}

export function formatPlainLine(
  status: TaskStatus,
  message: string,
  current: number,
  total: number | undefined,
  elapsedMs: number,
): string {
  return `[${status}] ${formatTaskDetails(message, current, total, elapsedMs)}`;
}

export function writePlainLine(stream: NodeJS.WritableStream, line: string): void {
  stream.write(`${line}\n`);
}

export class PlainRenderer implements Renderer {
  #stream: NodeJS.WritableStream;

  constructor(stream: NodeJS.WritableStream) {
    this.#stream = stream;
  }

  renderActive(view: RenderView): void {
    writePlainLine(
      this.#stream,
      formatPlainLine(view.status, view.message, view.current, view.total, view.elapsedMs),
    );
  }

  renderFinal(view: RenderView): void {
    this.renderActive(view);
  }
}
