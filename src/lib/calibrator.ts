import { BarRegion, CalibrationData } from './types';

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
        buffs,
        debuffs,
        enemy: enemy ?? null,
        timestamp: Date.now(),
        rsScaling,
    };
}
