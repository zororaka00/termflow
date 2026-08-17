import { formatElapsed } from './elapsed.js';
import { formatProgress } from './progress.js';
import { colorize } from './color.js';
import type { ColorThemeSnapshot } from './color.js';
import type { Renderer, RenderView } from './renderer.js';
import { truncateVisible } from './text.js';
import type { TaskProgressBarOptions, TaskStatus } from './types.js';

export function formatTaskDetails(
  message: string,
  current: number,
  total: number | undefined,
  elapsedMs: number,
  progressBar?: TaskProgressBarOptions,
  colors?: ColorThemeSnapshot,
  colorEnabled = false,
): string {
  const progress =
    total === undefined
      ? ''
      : ` ${colorize(formatProgress(current, total, progressBar), colorEnabled ? colors?.progress : undefined)}`;
  const elapsed = colorize(`(${formatElapsed(elapsedMs)})`, colorEnabled ? colors?.elapsed : undefined);
  return `${escapeTerminalControls(message)}${progress} ${elapsed}`;
}

export function escapeTerminalControls(value: string): string {
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
  columns?: number,
  statusSymbol?: string,
  progressBar?: TaskProgressBarOptions,
  colors?: ColorThemeSnapshot,
  colorEnabled = false,
): string {
  const statusLabel = `[${statusSymbol ?? status}]`;
  const statusColor = status === 'pending' ? undefined : colors?.[status];
  return truncateVisible(
    `${colorize(statusLabel, colorEnabled ? statusColor : undefined)} ${formatTaskDetails(message, current, total, elapsedMs, progressBar, colors, colorEnabled)}`,
    columns,
  );
}

export function formatLogLine(record: string, columns?: number): string {
  return truncateVisible(`[log] ${escapeTerminalControls(record)}`, columns);
}

export function formatCustomLine(view: RenderView): string | undefined {
  if (view.format === undefined) {
    return undefined;
  }
  const line = view.format(view);
  if (typeof line !== 'string') {
    throw new TypeError('format must return a string.');
  }
  return truncateVisible(escapeTerminalControls(line), view.columns);
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
        ),
    );
  }

  renderFinal(view: RenderView, _clearActiveLine: boolean): void {
    this.renderActive(view);
  }
}
