import { CLEAR_LINE } from './ansi.js';
import { formatPlainLine, formatTaskDetails } from './plain-renderer.js';
import type { Renderer, RenderView } from './renderer.js';

export class TtyRenderer implements Renderer {
  #stream: NodeJS.WritableStream;

  constructor(stream: NodeJS.WritableStream) {
    this.#stream = stream;
  }

  renderActive(view: RenderView): void {
    this.#stream.write(
      `${CLEAR_LINE}${view.spinnerFrame} ${formatTaskDetails(
        view.message,
        view.current,
        view.total,
        view.elapsedMs,
      )}`,
    );
  }

  renderFinal(view: RenderView): void {
    this.#stream.write(
      `${CLEAR_LINE}${formatPlainLine(
        view.status,
        view.message,
        view.current,
        view.total,
        view.elapsedMs,
      )}\n`,
    );
  }
}
