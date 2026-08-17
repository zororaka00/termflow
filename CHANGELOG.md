# Changelog

All notable changes to this project are documented in this file.

## 0.3.0

- Added dependency-free, opt-in semantic colors for task statuses, spinner, progress, and elapsed-time slots. Output remains strictly no-color unless callers pass `colors`.
- Added validated named, structured SGR, ANSI 256-color, RGB, and six-digit hex color specifications with ANSI-safe reset handling and color-aware truncation.
- Added documented `NO_COLOR`, ANSI-mode, TTY, CI, static-group inheritance, and accessibility behavior; `NO_COLOR` and `ansi: 'never'` always suppress configured colors.

## 0.2.0

- Added the presentation-only `createTaskGroup()` API for deterministic, isolated multi-task static output and sealed final summaries that retain terminal child records through independent disposal.
- Added lightweight spinner-frame, status-symbol, progress-bar, and safe formatting customization without runtime dependencies.
- Switched the default elapsed-time source to Node's monotonic `performance.now()` while preserving injected clocks and schedulers.
- Added explicit plain-output policies, lifecycle cleanup, safe task-owned log passthrough, width-aware truncation, and static/accessibility/silent rendering modes.
- Added immutable terminal records and deterministic tests for output safety and lifecycle behavior.

## 0.1.0

- Initial standalone ESM/TypeScript release of the single-task terminal lifecycle API.
- Added dependency-free ASCII spinner, fixed-width progress output, elapsed time, ANSI mode selection, and safe plain fallback records.
- Added deterministic lifecycle, rendering, environment, validation, and stream-safety tests.
