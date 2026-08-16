import { CLEAR_LINE } from './ansi.js';
import { formatCustomLine, formatPlainLine, formatTaskDetails } from './plain-renderer.js';
import type { Renderer, RenderView } from './renderer.js';
import { truncateVisible } from './text.js';

export class TtyRenderer implements Renderer {
  #stream: NodeJS.WritableStream;

  constructor(stream: NodeJS.WritableStream) {
    this.#stream = stream;
  }

  renderActive(view: RenderView): void {
    const line =
      formatCustomLine(view) ??
      truncateVisible(
        `${view.spinnerFrame} ${formatTaskDetails(
          view.message,
          view.current,
          view.total,
          view.elapsedMs,
          view.progressBar,
        )}`,
        view.columns,
      );
    this.#stream.write(
      `${CLEAR_LINE}${line}`,
    );
  }

  renderFinal(view: RenderView, clearActiveLine: boolean): void {
    const line =
      formatCustomLine(view) ??
      formatPlainLine(
        view.status,
        view.message,
        view.current,
        view.total,
        view.elapsedMs,
        view.columns,
        view.statusSymbol,
        view.progressBar,
      );
    this.#stream.write(
      `${clearActiveLine ? CLEAR_LINE : ''}${line}\n`,
    );
  }
}
