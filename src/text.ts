const COMBINING_MARK = /\p{Mark}/u;
const ANSI_RESET = '\u001B[0m';

/** Return a conservative terminal-cell width without splitting Unicode code points. */
export function visibleWidth(value: string): number {
  let width = 0;
  for (let index = 0; index < value.length; ) {
    const sgr = sgrAt(value, index);
    if (sgr !== undefined) {
      index += sgr.length;
      continue;
    }
    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    if (
      codePoint === 0x200d ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      COMBINING_MARK.test(character)
    ) {
      index += character.length;
      continue;
    }
    width += isWide(codePoint) ? 2 : 1;
    index += character.length;
  }
  return width;
}

/** Truncate a safe display string to a maximum visible width. */
export function truncateVisible(value: string, maximumWidth: number | undefined): string {
  if (maximumWidth === undefined || visibleWidth(value) <= maximumWidth) {
    return value;
  }
  if (maximumWidth <= 0) {
    return '';
  }

  const marker = '…';
  const contentWidth = maximumWidth - visibleWidth(marker);
  if (contentWidth <= 0) {
    return marker;
  }

  let result = '';
  let width = 0;
  const styles = new Set<string>();
  for (let index = 0; index < value.length; ) {
    const sgr = sgrAt(value, index);
    if (sgr !== undefined) {
      result += sgr;
      applySgr(sgr, styles);
      index += sgr.length;
      continue;
    }
    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    const characterWidth = visibleWidth(character);
    if (width + characterWidth > contentWidth) {
      return `${result}${styles.size === 0 ? '' : ANSI_RESET}${marker}`;
    }
    result += character;
    width += characterWidth;
    index += character.length;
  }
  return `${result}${marker}`;
}

function sgrAt(value: string, index: number): string | undefined {
  if (value[index] !== '\u001B' || value[index + 1] !== '[') {
    return undefined;
  }
  const end = value.indexOf('m', index + 2);
  if (end === -1) {
    return undefined;
  }
  const parameters = value.slice(index + 2, end);
  return /^[0-9;]*$/u.test(parameters) ? value.slice(index, end + 1) : undefined;
}

function applySgr(sequence: string, styles: Set<string>): void {
  const parameters = sequence.slice(2, -1).split(';').map((parameter) =>
    parameter === '' ? 0 : Number(parameter),
  );
  for (const parameter of parameters) {
    if (parameter === 0) {
      styles.clear();
    } else if (parameter === 1 || parameter === 2) {
      styles.add('intensity');
    } else if (parameter === 3) {
      styles.add('italic');
    } else if (parameter === 4) {
      styles.add('underline');
    } else if (parameter === 9) {
      styles.add('strikethrough');
    } else if (parameter === 22) {
      styles.delete('intensity');
    } else if (parameter === 23) {
      styles.delete('italic');
    } else if (parameter === 24) {
      styles.delete('underline');
    } else if (parameter === 29) {
      styles.delete('strikethrough');
    } else if (
      (parameter >= 30 && parameter <= 37) ||
      (parameter >= 90 && parameter <= 97) ||
      parameter === 38
    ) {
      styles.add('foreground');
    } else if (parameter === 39) {
      styles.delete('foreground');
    }
  }
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
