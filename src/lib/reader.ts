import * as a1lib from 'alt1';
import { BarRegion, BuffSlot, RGBColor } from './types';
import { readTimerFromPixels } from './digit-reader';
import { debugLog } from './debug';

/**
 * Custom BuffReader that works at any UI scale.
 *
 * Unlike the built-in alt1/buffs BuffReader which requires exact 27x27
 * template matches at 100% scale, this reader uses the BarRegion info
 * from our detector (which already knows the grid size and border color)
 * to read buffs at whatever scale the game is running at.
 */
export class BuffBarReader {
    region: BarRegion;

    constructor(region: BarRegion) {
        this.region = region;
    }

    /**
     * Update the bar region (e.g. after re-detection or calibration)
     */
    setRegion(region: BarRegion): void {
        this.region = region;
    }

    /**
     * Calculate the screen rectangle to capture for reading all buff slots.
     */
    getCaptureRect(): { x: number; y: number; width: number; height: number } {
        return {
            x: this.region.x,
            y: this.region.y,
            width: (this.region.maxColumns + 1) * this.region.gridSize,
            height: (this.region.maxRows + 1) * this.region.gridSize,
        };
    }

    /**
     * Read all active buff/debuff slots from the bar.
     * Returns an array of BuffSlot objects for each detected active icon.
     */
    read(buffer?: ImageData): BuffSlot[] {
        const rect = this.getCaptureRect();

        if (!buffer) {
            if (!window.alt1 || !alt1.permissionPixel) {
                return [];
            }
            buffer = a1lib.capture(rect.x, rect.y, rect.width, rect.height);
            if (!buffer) return [];
        }

        const slots: BuffSlot[] = [];
        const { gridSize, iconSize, borderColor, isDebuff } = this.region;

        // ONE-TIME position dump
        if (!(this as any)._posDumped) {
            (this as any)._posDumped = true;
            debugLog(`[Reader] Buffer: ${buffer.width}x${buffer.height}, grid=${gridSize}, icon=${iconSize}, maxCol=${this.region.maxColumns}, maxRow=${this.region.maxRows}`);
            debugLog(`[Reader] Screen origin: (${this.region.x}, ${this.region.y})`);
        }

        for (let row = 0; row <= this.region.maxRows; row++) {
            for (let col = 0; col <= this.region.maxColumns; col++) {
                const px = col * gridSize;
                const py = row * gridSize;

                // Check if this slot has a border (= has an active buff)
                const hasBorder = this.hasActiveBorder(buffer, px, py);

                // Log slot alignment for first read
                if (!(this as any)._slotsDumped) {
                    const screenX = this.region.x + px;
                    const screenY = this.region.y + py;
                    if (px < buffer.width && py < buffer.height) {
                        // Sample top-left corner pixel
                        const i0 = (py * buffer.width + px) * 4;
                        const r0 = buffer.data[i0], g0 = buffer.data[i0+1], b0 = buffer.data[i0+2];
                        // Sample a few more border pixels along top edge
                        const samples: string[] = [];
                        for (let dx = 0; dx < Math.min(27, buffer.width - px); dx += 5) {
                            const si = (py * buffer.width + (px + dx)) * 4;
                            samples.push(`R${buffer.data[si]}G${buffer.data[si+1]}B${buffer.data[si+2]}`);
                        }
                        debugLog(`[Reader] Slot (${col},${row}): screen=(${screenX},${screenY}) border=${hasBorder} topEdge=[${samples.join(', ')}]`);
                    }
                }

                if (!hasBorder) {
                    // Enemy debuff bar can have gaps between icons — scan past them.
                    // Player buff/debuff bars are always contiguous — break is correct there.
                    if (this.region.isEnemy) {
                        continue;
                    }
                    break;
                }

                // Extract full icon data (including border for matching against reference images)
                const iconX = px;
                const iconY = py;
                const iconW = iconSize;
                const iconH = iconSize;

                let iconData: ImageData;
                try {
                    iconData = extractSubImage(buffer, iconX, iconY, iconW, iconH);
                } catch {
                    continue;
                }

                // Read timer/arg text
                // Primary: lower-left position (bufferX + 2, bufferY + 23 at 100% scale)
                const textOffsetX = Math.round(2 * (gridSize / 30));
                const textOffsetY = Math.round(23 * (gridSize / 30));
                const { time, argText } = this.readTimerText(
                    buffer,
                    px + textOffsetX,
                    py + textOffsetY,
                );

                slots.push({
                    column: col,
                    row,
                    iconData,
                    bufferX: px,
                    bufferY: py,
                    isDebuff,
                    time,
                    altTime: 0,
                    argText,
                });
            }
        }

        // Mark slot dump as done
        if (!(this as any)._slotsDumped) {
            (this as any)._slotsDumped = true;
            debugLog(`[Reader] Found ${slots.length} active slots on first scan`);
        }

        // Update maxColumns based on what we actually found
        if (slots.length > 0) {
            const maxFoundCol = Math.max(...slots.map(s => s.column));
            this.region.maxColumns = Math.max(5, maxFoundCol + 2);
        }

        return slots;
    }

    /**
     * Check if a grid slot has an active buff border by sampling
     * border pixels and comparing to the expected border color.
     *
     * Checks for the specific RS3 buff/debuff border colors with tight tolerance.
     * Buff border: RGB(90,150,25) ±15 per channel
     * Debuff border: RGB(204,0,0) ±15 per channel
     * This filters out action bar icons which have different border styling.
     */
    private hasActiveBorder(buffer: ImageData, px: number, py: number): boolean {
        const { gridSize, isDebuff, isEnemy } = this.region;
        const w = buffer.width;
        const data = buffer.data;

        // Known border colors
        const BUFF_BORDER = { r: 90, g: 150, b: 25 };
        const DEBUFF_BORDER = { r: 204, g: 0, b: 0 };
        const TOLERANCE = 15;

        // Enemy debuff bar uses red borders just like player debuffs
        const target = (isDebuff || isEnemy) ? DEBUFF_BORDER : BUFF_BORDER;

        const isMatch = (r: number, g: number, b: number): boolean => {
            return Math.abs(r - target.r) <= TOLERANCE &&
                   Math.abs(g - target.g) <= TOLERANCE &&
                   Math.abs(b - target.b) <= TOLERANCE;
        };

        let matchCount = 0;
        let sampleCount = 0;
        const sampleStep = Math.max(1, Math.floor(gridSize / 10));

        // Sample along top edge
        for (let dx = 0; dx < gridSize - 3 && px + dx < w; dx += sampleStep) {
            const x = px + dx;
            const y = py;
            if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) continue;

            const i = (y * w + x) * 4;
            sampleCount++;
            if (isMatch(data[i], data[i + 1], data[i + 2])) matchCount++;
        }

        // Sample along left edge
        for (let dy = 2; dy < gridSize - 5 && py + dy < buffer.height; dy += sampleStep * 2) {
            const x = px;
            const y = py + dy;
            if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) continue;

            const i = (y * w + x) * 4;
            sampleCount++;
            if (isMatch(data[i], data[i + 1], data[i + 2])) matchCount++;
        }

        return sampleCount > 0 && (matchCount / sampleCount) >= 0.4;
    }

    /**
     * Read timer text from a buff icon using custom digit reader.
     * No Alt1 OCR dependency — reads white pixels directly.
     */
    private readTimerText(
        buffer: ImageData,
        ox: number,
        oy: number,
    ): { time: number; argText: string } {
        return readTimerFromPixels(buffer, ox, oy, 'up', this.region.gridSize);
    }
}

/**
 * Extract a sub-region from an ImageData buffer.
 */
function extractSubImage(
    source: ImageData,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
): ImageData {
    if (sx < 0 || sy < 0 || sx + sw > source.width || sy + sh > source.height) {
        throw new RangeError(
            `Sub-image bounds (${sx},${sy},${sw},${sh}) exceed source (${source.width}x${source.height})`,
        );
    }

    const result = new ImageData(sw, sh);
    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const si = ((sy + y) * source.width + (sx + x)) * 4;
            const di = (y * sw + x) * 4;
            result.data[di] = source.data[si];
            result.data[di + 1] = source.data[si + 1];
            result.data[di + 2] = source.data[si + 2];
            result.data[di + 3] = source.data[si + 3];
        }
    }
    return result;
}

/**
 * Compare two buff icons for similarity using per-pixel RGB comparison.
 * Original custom matching approach — kept intact.
 * See also: findSubimage-based matching in index.ts (Alt1 native search).
 */
export function compareBuffIcons(
    captured: ImageData,
    reference: ImageData,
    tolerance: number = 80,
    mask: 'default' | 'dual-text' = 'default',
): { passed: number; failed: number; tested: number } {
    const result = { passed: 0, failed: 0, tested: 0 };

    const cw = captured.width;
    const ch = captured.height;
    const rw = reference.width;
    const rh = reference.height;

    if (cw === 0 || ch === 0 || rw === 0 || rh === 0) return result;

    // Skip border pixels — scale-aware. At 100% (27px), border = 1px.
    // At higher UI scales, use ceil to ensure border contamination is fully stripped.
    const cBorder = Math.max(1, Math.ceil(cw / 27));
    const rBorder = Math.max(1, Math.ceil(rw / 27));

    // Interior dimensions after stripping border
    const cInnerW = cw - cBorder * 2;
    const cInnerH = ch - cBorder * 2;
    const rInnerW = rw - rBorder * 2;
    const rInnerH = rh - rBorder * 2;

    if (cInnerW <= 0 || cInnerH <= 0 || rInnerW <= 0 || rInnerH <= 0) return result;

    // Scale factors for nearest-neighbor sampling of interior only
    const sx = rInnerW / cInnerW;
    const sy = rInnerH / cInnerH;

    // Skip bottom 8 rows of the icon (timer text overlay zone, rows 19-26 of 27px).
    // Scale the mask proportionally for different icon sizes.
    const timerMaskRows = Math.round(8 * (cInnerH / 25)); // 8 rows at 27px/25px-interior scale
    const compareH = Math.max(1, cInnerH - timerMaskRows);

    // Dual-text mask: also skip upper-left zone (timer text in top-left corner)
    const leftMaskCols = mask === 'dual-text' ? Math.round(10 * (cInnerW / 25)) : 0;
    const topMaskRows = mask === 'dual-text' ? Math.round(8 * (cInnerH / 25)) : 0;

    for (let y = 0; y < compareH; y++) {
        for (let x = 0; x < cInnerW; x++) {
            // Skip upper-left timer zone for dual-text mask
            if (mask === 'dual-text' && y < topMaskRows && x < leftMaskCols) continue;

            // Map captured interior pixel to reference interior pixel
            const cx = x + cBorder;
            const cy = y + cBorder;
            const rx = Math.min(Math.floor(x * sx), rInnerW - 1) + rBorder;
            const ry = Math.min(Math.floor(y * sy), rInnerH - 1) + rBorder;

            const ci = (cy * cw + cx) * 4;
            const ri = (ry * rw + rx) * 4;

            // Skip transparent reference pixels
            if (reference.data[ri + 3] < 128) continue;

            // Skip pure white/black pixels (timer text overlay)
            const cr = captured.data[ci];
            const cg = captured.data[ci + 1];
            const cb = captured.data[ci + 2];
            if ((cr > 240 && cg > 240 && cb > 240) ||
                (cr < 15 && cg < 15 && cb < 15)) {
                continue;
            }

            result.tested++;

            const dr = Math.abs(cr - reference.data[ri]);
            const dg = Math.abs(cg - reference.data[ri + 1]);
            const db = Math.abs(cb - reference.data[ri + 2]);
            const dist = dr + dg + db;

            if (dist > tolerance) {
                result.failed++;
            } else {
                result.passed++;
            }
        }
    }

    return result;
}
