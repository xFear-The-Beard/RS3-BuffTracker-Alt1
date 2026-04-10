import * as a1lib from 'alt1';
import { BarRegion, DetectionResult, RGBColor } from './types';
import { debugLog } from './debug';

/**
 * Click-to-anchor buff/debuff bar detector.
 *
 * Instead of scanning the full screen for colored pixel clusters (which
 * produces false positives from equipment windows, chat text, etc.),
 * this detector asks the user to click on a buff icon. From that anchor
 * point, it validates the clicked region and expands outward to find
 * the full bar extent.
 *
 * HOW IT WORKS:
 * 1. User clicks on a buff/debuff icon in the game
 * 2. We get the click coordinates via a1lib.getMousePosition()
 * 3. Capture a region around the click point
 * 4. Validate: check for a bordered square at the click (1px colored border, dark interior)
 * 5. Measure the icon/grid size from the detected square
 * 6. Expand outward: walk left/right to find adjacent icons
 * 7. Return the full bar region with grid parameters
 */

// --- Size expectations ---
// Range covers roughly 60%-260% of the default RS3 UI scale.
// Expanded from the original 75%-185% range to support 4K monitors at very small
// scale (icons ~16px) and small displays at very large scale (icons ~70px).
const EXPECTED_ICON_SIZES = { min: 16, default: 27, max: 70 };
const EXPECTED_GRID_SIZES = { min: 18, default: 30, max: 80 };

/** How far around the click to capture for analysis (pixels) */
const CAPTURE_RADIUS = 200;

/** Max brightness for a pixel to count as "dark interior" */
const DARK_THRESHOLD = 60;

/** Minimum border color saturation to count as colored (not grey) */
const BORDER_MIN_DIFF = 15;

/**
 * Check if a pixel is a green buff border pixel.
 */
function isGreenBorder(r: number, g: number, b: number): boolean {
    return g > 40 && (g - b) > BORDER_MIN_DIFF && (g - r) > -15;
}

/**
 * Check if a pixel is a red debuff border pixel.
 */
function isRedBorder(r: number, g: number, b: number): boolean {
    return r > 60 && (r - g) > 20 && (r - b) > 10;
}

/**
 * Check if a pixel is "dark" (typical buff icon interior or gap).
 */
function isDark(r: number, g: number, b: number): boolean {
    return r < DARK_THRESHOLD && g < DARK_THRESHOLD && b < DARK_THRESHOLD;
}

/**
 * From a click point, find the edges of the icon square the user clicked on.
 * Walks outward in each direction until hitting a colored border, then
 * continues past the border to find the outer edge.
 *
 * Returns the bounding box of the icon (including border) or null if
 * no valid icon structure found.
 */
function findIconAtPoint(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    clickX: number,
    clickY: number,
    isBorderFn: (r: number, g: number, b: number) => boolean,
): { left: number; top: number; right: number; bottom: number; iconSize: number } | null {

    // Helper to read pixel
    const px = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return { r: 0, g: 0, b: 0 };
        const i = (y * width + x) * 4;
        return { r: data[i], g: data[i + 1], b: data[i + 2] };
    };

    // First, find the top border: scan upward from click until we find a border row
    let topBorder = -1;
    for (let y = clickY; y >= Math.max(0, clickY - 60); y--) {
        const p = px(clickX, y);
        if (isBorderFn(p.r, p.g, p.b)) {
            topBorder = y;
            break;
        }
    }
    if (topBorder < 0) {
        debugLog(`[Detector] No top border found scanning up from (${clickX},${clickY})`);
        return null;
    }

    // Find the bottom border: scan downward from click
    let bottomBorder = -1;
    for (let y = clickY; y <= Math.min(height - 1, clickY + 60); y++) {
        const p = px(clickX, y);
        if (isBorderFn(p.r, p.g, p.b)) {
            bottomBorder = y;
            // Don't break — keep going to find the LAST border row
        } else if (bottomBorder >= 0) {
            // Past the border
            break;
        }
    }
    if (bottomBorder < 0) {
        debugLog(`[Detector] No bottom border found scanning down from (${clickX},${clickY})`);
        return null;
    }

    // Find left border: scan left from click
    let leftBorder = -1;
    for (let x = clickX; x >= Math.max(0, clickX - 60); x--) {
        const p = px(x, clickY);
        if (isBorderFn(p.r, p.g, p.b)) {
            leftBorder = x;
            break;
        }
    }
    if (leftBorder < 0) {
        debugLog(`[Detector] No left border found scanning left from (${clickX},${clickY})`);
        return null;
    }

    // Find right border: scan right from click
    let rightBorder = -1;
    for (let x = clickX; x <= Math.min(width - 1, clickX + 60); x++) {
        const p = px(x, clickY);
        if (isBorderFn(p.r, p.g, p.b)) {
            rightBorder = x;
        } else if (rightBorder >= 0) {
            break;
        }
    }
    if (rightBorder < 0) {
        debugLog(`[Detector] No right border found scanning right from (${clickX},${clickY})`);
        return null;
    }

    // Now refine: find the TRUE top-left corner of this icon.
    // Scan along the top border row to find where it starts (left edge)
    let trueLeft = leftBorder;
    for (let x = leftBorder; x >= Math.max(0, leftBorder - 5); x--) {
        const p = px(x, topBorder);
        if (isBorderFn(p.r, p.g, p.b)) {
            trueLeft = x;
        } else {
            break;
        }
    }

    // Find true top: scan along left border column upward
    let trueTop = topBorder;
    for (let y = topBorder; y >= Math.max(0, topBorder - 5); y--) {
        const p = px(trueLeft, y);
        if (isBorderFn(p.r, p.g, p.b)) {
            trueTop = y;
        } else {
            break;
        }
    }

    const iconW = rightBorder - trueLeft + 1;
    const iconH = bottomBorder - trueTop + 1;

    // Validate: should be square-ish and within expected size range
    if (iconW < EXPECTED_ICON_SIZES.min || iconW > EXPECTED_ICON_SIZES.max ||
        iconH < EXPECTED_ICON_SIZES.min || iconH > EXPECTED_ICON_SIZES.max) {
        debugLog(`[Detector] Icon size ${iconW}x${iconH} outside expected range`);
        return null;
    }
    if (Math.abs(iconW - iconH) > 4) {
        debugLog(`[Detector] Icon not square: ${iconW}x${iconH}`);
        return null;
    }

    const iconSize = Math.round((iconW + iconH) / 2);

    debugLog(`[Detector] Found icon at (${trueLeft},${trueTop}) size ${iconW}x${iconH} → iconSize=${iconSize}`);

    return { left: trueLeft, top: trueTop, right: rightBorder, bottom: bottomBorder, iconSize };
}

/**
 * From a confirmed icon, measure grid spacing by looking for the next icon to the right.
 */
function measureGridSpacing(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    iconRight: number,
    iconTop: number,
    iconSize: number,
    isBorderFn: (r: number, g: number, b: number) => boolean,
): number {
    const midY = iconTop + Math.floor(iconSize / 2);
    const px = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return { r: 0, g: 0, b: 0 };
        const i = (y * width + x) * 4;
        return { r: data[i], g: data[i + 1], b: data[i + 2] };
    };

    // Scan right from the icon's right edge. Should be a small dark gap then another border.
    for (let dx = 1; dx <= 10; dx++) {
        const x = iconRight + dx;
        const p = px(x, midY);
        if (isBorderFn(p.r, p.g, p.b)) {
            // Found the next icon's left border
            // Grid spacing = distance from left edge of this icon to left edge of next
            // Next icon left = x, this icon left = iconRight - iconSize + 1
            const thisLeft = iconRight - iconSize + 1;
            const gridSize = x - thisLeft;
            debugLog(`[Detector] Grid spacing measured: ${gridSize}px (gap at dx=${dx})`);
            if (gridSize >= EXPECTED_GRID_SIZES.min && gridSize <= EXPECTED_GRID_SIZES.max) {
                return gridSize;
            }
        }
    }

    // Fallback: estimate from icon size (grid ≈ iconSize + 3 at 100% scale)
    const estimated = iconSize + 3;
    debugLog(`[Detector] Grid spacing estimated from icon size: ${estimated}px`);
    return estimated;
}

/**
 * From the anchor icon, expand outward to count how many icons are in the bar.
 * Walks left and right, checking for border pixels at each grid step.
 */
function countBarExtent(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    anchorLeft: number,
    anchorTop: number,
    gridSize: number,
    iconSize: number,
    isBorderFn: (r: number, g: number, b: number) => boolean,
): { barLeft: number; totalSlots: number } {
    const midY = anchorTop + Math.floor(iconSize / 2);
    const px = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return { r: 0, g: 0, b: 0 };
        const i = (y * width + x) * 4;
        return { r: data[i], g: data[i + 1], b: data[i + 2] };
    };

    // Check if there's a valid icon at a given grid position
    const hasIconAt = (left: number): boolean => {
        // Check top-left corner for border
        const topLeft = px(left, anchorTop);
        if (isBorderFn(topLeft.r, topLeft.g, topLeft.b)) return true;
        // Check a few pixels into the top border
        const topMid = px(left + Math.floor(iconSize / 2), anchorTop);
        if (isBorderFn(topMid.r, topMid.g, topMid.b)) return true;
        return false;
    };

    // Count icons to the left of the anchor
    let leftCount = 0;
    let leftMost = anchorLeft;
    for (let i = 1; i <= 30; i++) {
        const testX = anchorLeft - i * gridSize;
        if (testX < 0) break;
        if (hasIconAt(testX)) {
            leftCount++;
            leftMost = testX;
        } else {
            break;
        }
    }

    // Count icons to the right of the anchor
    let rightCount = 0;
    for (let i = 1; i <= 30; i++) {
        const testX = anchorLeft + i * gridSize;
        if (testX + iconSize >= width) break;
        if (hasIconAt(testX)) {
            rightCount++;
        } else {
            break;
        }
    }

    const totalSlots = leftCount + 1 + rightCount;
    debugLog(`[Detector] Bar extent: ${leftCount} left + anchor + ${rightCount} right = ${totalSlots} slots`);
    return { barLeft: leftMost, totalSlots };
}

/**
 * Sample the border color from the anchor icon.
 */
function sampleBorderColor(
    data: Uint8ClampedArray,
    width: number,
    iconLeft: number,
    iconTop: number,
    iconSize: number,
): RGBColor {
    let totalR = 0, totalG = 0, totalB = 0, count = 0;

    // Sample along top border
    for (let x = iconLeft; x < iconLeft + iconSize && x < width; x++) {
        const i = (iconTop * width + x) * 4;
        totalR += data[i];
        totalG += data[i + 1];
        totalB += data[i + 2];
        count++;
    }

    if (count === 0) return { r: 0, g: 0, b: 0 };

    return {
        r: Math.round(totalR / count),
        g: Math.round(totalG / count),
        b: Math.round(totalB / count),
    };
}

/**
 * Detect a buff or debuff bar from a user click point.
 *
 * Call this after the user has clicked on a buff/debuff icon.
 * Reads mouse position, captures the region, validates, and expands
 * to find the full bar.
 */
export function detectBarFromClick(isDebuff: boolean): DetectionResult {
    if (!window.alt1 || !alt1.permissionPixel) {
        return { success: false, region: null, confidence: 0, message: 'Alt1 not available or pixel permission denied' };
    }

    // Get the mouse position inside the RS client
    const mousePos = a1lib.getMousePosition();
    if (!mousePos || (mousePos.x === 0 && mousePos.y === 0)) {
        return { success: false, region: null, confidence: 0, message: 'Could not read mouse position. Click inside the RS window on a buff icon.' };
    }

    const clickX = mousePos.x;
    const clickY = mousePos.y;
    debugLog(`[Detector] Click-to-anchor at (${clickX}, ${clickY}), isDebuff=${isDebuff}`);

    // Capture a region around the click point
    const captureX = Math.max(0, clickX - CAPTURE_RADIUS);
    const captureY = Math.max(0, clickY - CAPTURE_RADIUS);
    const captureW = Math.min(CAPTURE_RADIUS * 2, alt1.rsWidth - captureX);
    const captureH = Math.min(CAPTURE_RADIUS * 2, alt1.rsHeight - captureY);

    let img: ImageData;
    try {
        img = a1lib.captureHold(captureX, captureY, captureW, captureH).toData();
    } catch (e) {
        return { success: false, region: null, confidence: 0, message: `Screen capture failed: ${e}` };
    }

    debugLog(`[Detector] Captured ${img.width}x${img.height} region at (${captureX},${captureY})`);

    // Click position relative to captured region
    const localX = clickX - captureX;
    const localY = clickY - captureY;

    const isBorderFn = isDebuff ? isRedBorder : isGreenBorder;

    // Step 1: Find the icon at the click point
    const icon = findIconAtPoint(img.data, img.width, img.height, localX, localY, isBorderFn);
    if (!icon) {
        return {
            success: false, region: null, confidence: 0,
            message: `No ${isDebuff ? 'debuff' : 'buff'} icon found at click point. Make sure you clicked on a buff icon with a ${isDebuff ? 'red' : 'green'} border.`,
        };
    }

    // Step 2: Measure grid spacing from this icon
    const gridSize = measureGridSpacing(img.data, img.width, img.height, icon.right, icon.top, icon.iconSize, isBorderFn);

    // Step 3: Expand to find the full bar extent
    const { barLeft, totalSlots } = countBarExtent(
        img.data, img.width, img.height,
        icon.left, icon.top, gridSize, icon.iconSize, isBorderFn,
    );

    // Step 4: Sample border color
    const borderColor = sampleBorderColor(img.data, img.width, icon.left, icon.top, icon.iconSize);

    // Convert from local (capture region) coordinates back to screen coordinates
    const screenX = captureX + barLeft;
    const screenY = captureY + icon.top;

    // Check for a second row (debuffs often appear below buffs)
    let maxRows = 1;
    const rowBelowY = icon.top + gridSize;
    if (rowBelowY + icon.iconSize < img.height) {
        const midX = icon.left + Math.floor(icon.iconSize / 2);
        const i = (rowBelowY * img.width + midX) * 4;
        const p = { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
        if (isBorderFn(p.r, p.g, p.b)) {
            maxRows = 2;
            debugLog(`[Detector] Found second row at y+${gridSize}`);
        }
    }

    const region: BarRegion = {
        x: screenX,
        y: screenY,
        isDebuff,
        iconSize: icon.iconSize,
        gridSize,
        maxColumns: Math.max(totalSlots + 5, 18), // add headroom for buffs that appear later
        maxRows,
        borderColor,
    };

    const confidence = Math.min(1, totalSlots / 3);

    return {
        success: true,
        region,
        confidence,
        message: `Found ${isDebuff ? 'debuff' : 'buff'} bar at (${screenX}, ${screenY}), ` +
                 `grid: ${gridSize}px, icon: ${icon.iconSize}px, ${totalSlots} visible slots, ` +
                 `border: RGB(${borderColor.r},${borderColor.g},${borderColor.b})`,
    };
}

/**
 * Legacy full-screen detection (kept for fallback but no longer primary).
 */
export function detectBar(isDebuff: boolean, img?: ImageData): DetectionResult {
    return { success: false, region: null, confidence: 0, message: 'Full-screen scan disabled. Use click-to-anchor detection.' };
}

/**
 * Legacy dual detection (kept for interface compatibility).
 */
export function detectBars(): { buffs: DetectionResult; debuffs: DetectionResult } {
    return {
        buffs: { success: false, region: null, confidence: 0, message: 'Use click-to-anchor detection.' },
        debuffs: { success: false, region: null, confidence: 0, message: 'Use click-to-anchor detection.' },
    };
}

/**
 * Get the current RS scaling factor.
 */
export function getRsScaling(): number {
    if (window.alt1 && typeof alt1.rsScaling === 'number' && alt1.rsScaling > 0) {
        return alt1.rsScaling;
    }
    return 1.0;
}
