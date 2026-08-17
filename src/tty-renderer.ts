import { CLEAR_LINE } from './ansi.js';
import { colorize } from './color.js';
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
        `${colorize(view.spinnerFrame, view.colorEnabled ? view.colors?.spinner : undefined)} ${formatTaskDetails(
          view.message,
          view.current,
          view.total,
          view.elapsedMs,
          view.progressBar,
          view.colors,
          view.colorEnabled,
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
        view.colors,
        view.colorEnabled,
      );
    this.#stream.write(
      `${clearActiveLine ? CLEAR_LINE : ''}${line}\n`,
    );
  }
}
