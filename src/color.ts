import type { AnsiMode, ColorSlot, ColorTheme, NamedColor, RenderMode } from './types.js';

const NAMED_COLOR_SGR: Readonly<Record<NamedColor, string>> = Object.freeze({
  black: '\u001B[30m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  magenta: '\u001B[35m',
  cyan: '\u001B[36m',
  white: '\u001B[37m',
  gray: '\u001B[90m',
});

const COLOR_SLOTS: readonly ColorSlot[] = [
  'running',
  'success',
  'failure',
  'warning',
  'cancelled',
  'skipped',
  'spinner',
  'progress',
  'elapsed',
];

const SAFE_ANSI_SGR_PARAMETERS = new Set([
  0,
  1,
  2,
  3,
  4,
  9,
  22,
  23,
  24,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  39,
  90,
  91,
  92,
  93,
  94,
  95,
  96,
  97,
]);

export const RESET_COLOR = '\u001B[0m';

/** Immutable map from semantic slots to validated SGR opening sequences. */
export type ColorThemeSnapshot = Readonly<Partial<Record<ColorSlot, string>>>;

export function snapshotColorTheme(colors: ColorTheme | undefined): ColorThemeSnapshot | undefined {
  if (colors === undefined) {
    return undefined;
  }
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    throw new TypeError('colors must be an object that maps semantic slots to color specifications.');
  }

  const snapshot: Partial<Record<ColorSlot, string>> = {};
  for (const [slot, specification] of Object.entries(colors)) {
    if (!isColorSlot(slot)) {
      throw new RangeError(`Unsupported color slot: ${slot}.`);
    }
    snapshot[slot] = colorSgr(specification, slot);
  }
  return Object.freeze(snapshot);
}

export function mergeColorThemes(
  base: ColorThemeSnapshot | undefined,
  override: ColorThemeSnapshot | undefined,
): ColorThemeSnapshot | undefined {
  if (base === undefined && override === undefined) {
    return undefined;
  }
  return Object.freeze({ ...base, ...override });
}

export function shouldUseColors(
  colors: ColorThemeSnapshot | undefined,
  ansi: AnsiMode,
  renderMode: RenderMode,
  stream: { isTTY?: boolean },
): boolean {
  if (colors === undefined || Object.keys(colors).length === 0 || renderMode === 'accessible') {
    return false;
  }
  if (process.env.NO_COLOR !== undefined || ansi === 'never') {
    return false;
  }
  if (ansi === 'always') {
    return true;
  }
  return stream.isTTY === true && process.env.CI === undefined && process.env.TERM !== 'dumb';
}

export function colorize(value: string, sgr: string | undefined): string {
  return sgr === undefined ? value : `${sgr}${value}${RESET_COLOR}`;
}

function colorSgr(specification: unknown, slot: string): string {
  if (typeof specification === 'string') {
    if (!isNamedColor(specification)) {
      throw new RangeError(`${slot} must use a supported named color.`);
    }
    return NAMED_COLOR_SGR[specification];
  }
  if (typeof specification !== 'object' || specification === null || Array.isArray(specification)) {
    throw new TypeError(`${slot} must be a named color or a supported structured color specification.`);
  }

  const keys = Object.keys(specification);
  if (keys.length !== 1) {
    throw new RangeError(`${slot} must define exactly one color form.`);
  }
  switch (keys[0]) {
    case 'ansiSgr':
      return ansiSgrCode((specification as { ansiSgr: unknown }).ansiSgr, slot);
    case 'ansi256':
      return `\u001B[38;5;${byte((specification as { ansi256: unknown }).ansi256, `${slot}.ansi256`)}m`;
    case 'rgb': {
      const rgb = (specification as { rgb: unknown }).rgb;
      return `\u001B[38;2;${rgbCode(rgb, slot)}m`;
    }
    case 'hex':
      return hexCode((specification as { hex: unknown }).hex, slot);
    default:
      throw new RangeError(`${slot} uses an unsupported color form: ${keys[0]}.`);
  }
}

function ansiSgrCode(value: unknown, slot: string): string {
  const parameters = typeof value === 'number' ? [value] : Array.isArray(value) ? Array.from(value) : [];
  if (
    parameters.length === 0 ||
    parameters.some(
      (parameter) =>
        typeof parameter !== 'number' ||
        !Number.isInteger(parameter) ||
        !SAFE_ANSI_SGR_PARAMETERS.has(parameter),
    )
  ) {
    throw new RangeError(`${slot}.ansiSgr must contain only supported integer color or style SGR parameters.`);
  }
  return `\u001B[${parameters.join(';')}m`;
}

function rgbCode(value: unknown, slot: string): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${slot}.rgb must be an object with r, g, and b byte channels.`);
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== 'b' || keys[1] !== 'g' || keys[2] !== 'r') {
    throw new RangeError(`${slot}.rgb must define exactly r, g, and b byte channels.`);
  }
  const channels = value as { r: unknown; g: unknown; b: unknown };
  return [
    byte(channels.r, `${slot}.rgb.r`),
    byte(channels.g, `${slot}.rgb.g`),
    byte(channels.b, `${slot}.rgb.b`),
  ].join(';');
}

function hexCode(value: unknown, slot: string): string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/u.test(value)) {
    throw new RangeError(`${slot}.hex must be a six-digit #RRGGBB color.`);
  }
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  return `\u001B[38;2;${red};${green};${blue}m`;
}

function byte(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${name} must be an integer between 0 and 255.`);
  }
  return value;
}

function isColorSlot(value: string): value is ColorSlot {
  return (COLOR_SLOTS as readonly string[]).includes(value);
}

function isNamedColor(value: string): value is NamedColor {
  return Object.hasOwn(NAMED_COLOR_SGR, value);
}
