import { BarRegion, CalibrationData, CALIBRATION_SCHEMA_VERSION } from './types';

const STORAGE_KEY = 'buffTracker_calibration';

/**
 * Save calibration data to localStorage.
 */
export function saveCalibration(data: CalibrationData): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[BuffTracker] Failed to save calibration:', e);
    }
}

/**
 * Load calibration data from localStorage.
 * Returns null if no calibration exists or data is invalid.
 */
export function loadCalibration(): CalibrationData | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const data: CalibrationData = JSON.parse(raw);

        // Validate structure
        if (typeof data.timestamp !== 'number') return null;

        // Schema version check. Older saves missing the field are treated as
        // version 0 — still loaded for now, but flagged so we know we're using
        // legacy data. Bump CALIBRATION_SCHEMA_VERSION on any shape change.
        const savedVersion = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
        if (savedVersion !== CALIBRATION_SCHEMA_VERSION) {
            console.warn(
                `[BuffTracker] Calibration schema version mismatch (saved=${savedVersion}, current=${CALIBRATION_SCHEMA_VERSION}). ` +
                `Loading anyway, but re-detecting is recommended if anything looks wrong.`
            );
        }

        // Calibration older than 7 days is suspect (Jagex may have updated)
        const age = Date.now() - data.timestamp;
        if (age > 7 * 24 * 60 * 60 * 1000) {
            console.info('[BuffTracker] Calibration data is older than 7 days, may be stale');
        }

        return data;
    } catch {
        return null;
    }
}

/**
 * Clear saved calibration data.
 */
export function clearCalibration(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Silently fail
    }
}

/**
 * Create CalibrationData from detected bar regions.
 */
export function createCalibration(
    buffs: BarRegion | null,
    debuffs: BarRegion | null,
    rsScaling: number,
    enemy?: BarRegion | null,
): CalibrationData {
    return {
        schemaVersion: CALIBRATION_SCHEMA_VERSION,
        buffs,
        debuffs,
        enemy: enemy ?? null,
        timestamp: Date.now(),
        rsScaling,
    };
}

/**
 * Returns true if the calibration is older than 7 days, suggesting that
 * a Jagex UI patch may have shifted the buff bar layout.
 */
export function isCalibrationStale(data: CalibrationData | null): boolean {
    if (!data || typeof data.timestamp !== 'number') return false;
    const age = Date.now() - data.timestamp;
    return age > 7 * 24 * 60 * 60 * 1000;
}
