/**
 * Represents a detected buff/debuff bar region on screen
 */
export interface BarRegion {
    /** Top-left X coordinate of the bar */
    x: number;
    /** Top-left Y coordinate of the bar */
    y: number;
    /** Whether this is a debuff bar */
    isDebuff: boolean;
    /** Detected icon size in pixels (27 at 100% scale) */
    iconSize: number;
    /** Detected grid spacing in pixels (30 at 100% scale) */
    gridSize: number;
    /** Maximum horizontal icon slots to scan */
    maxColumns: number;
    /** Maximum vertical rows to scan */
    maxRows: number;
    /** Whether this is the enemy target debuff bar (may have gaps between icons) */
    isEnemy?: boolean;
    /** Detected border color (averaged from captured pixels) */
    borderColor: RGBColor;
}

/**
 * Represents an individual buff/debuff read from the bar
 */
export interface BuffSlot {
    /** Grid column index (0-based) */
    column: number;
    /** Grid row index (0-based) */
    row: number;
    /** Raw pixel data of the buff icon (interior only, no border) */
    iconData: ImageData;
    /** Pixel X position in the captured region buffer */
    bufferX: number;
    /** Pixel Y position in the captured region buffer */
    bufferY: number;
    /** Whether this is a debuff */
    isDebuff: boolean;
    /** Timer text read from the icon (seconds remaining, 0 if no timer) */
    time: number;
    /** Secondary timer from upper-left position (for icons with stacks in lower-left, e.g. Skeleton Warrior) */
    altTime: number;
    /** Raw argument text (for stack counts, etc.) */
    argText: string;
}

/**
 * Simple RGB color tuple
 */
export interface RGBColor {
    r: number;
    g: number;
    b: number;
}

/**
 * Detection result from the bar finder
 */
export interface DetectionResult {
    success: boolean;
    region: BarRegion | null;
    confidence: number;
    message: string;
}

/**
 * Calibration data stored between sessions.
 *
 * `schemaVersion` lets us migrate or invalidate old saves cleanly when the
 * shape changes. Bump it whenever a field is added, removed, or its semantics
 * change. Loaders should treat a missing or older version as a hint to
 * re-detect rather than blindly using the data.
 */
export interface CalibrationData {
    /** Schema version for migration handling. Bump on shape changes. */
    schemaVersion: number;
    buffs: BarRegion | null;
    debuffs: BarRegion | null;
    /** Enemy target debuff region (for Invoke Death, Bloat, etc.) */
    enemy: BarRegion | null;
    timestamp: number;
    rsScaling: number;
}

/** Current calibration data schema version. Bump on any shape change. */
export const CALIBRATION_SCHEMA_VERSION = 1;

