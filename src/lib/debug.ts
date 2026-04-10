/**
 * Tiny gated debug logger for library code.
 *
 * Library files (detector, reader, icon-loader) can't import from the UI
 * layer without creating awkward dependencies, so this module exposes a
 * standalone flag. The flag is toggled by index.ts whenever debug mode
 * changes, and library code uses debugLog() in place of console.log() for
 * any output that should be silent in normal operation.
 *
 * console.error and console.warn calls in library code are NOT routed
 * through this — actual error output should remain visible regardless of
 * debug mode.
 */

let _enabled = false;

/** Toggle gated debug logging. Called by index.ts when debug mode changes. */
export function setDebugLogEnabled(enabled: boolean): void {
    _enabled = enabled;
}

/** Returns whether gated debug logging is currently enabled. */
export function isDebugLogEnabled(): boolean {
    return _enabled;
}

/** Log only if debug mode is enabled. Drop-in replacement for console.log. */
export function debugLog(...args: unknown[]): void {
    if (_enabled) console.log(...args);
}
