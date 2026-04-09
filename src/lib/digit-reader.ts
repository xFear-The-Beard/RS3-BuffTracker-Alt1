/**
 * Custom digit reader for RS3 buff-bar timer text.
 *
 * Reads white pixel patterns from the buff bar and matches them against
 * known digit templates using column-based character segmentation.
 * No Alt1 OCR dependency — reads pixels directly.
 *
 * Uses a dual-threshold approach: tries the strict threshold (180) first,
 * then retries with a relaxed threshold (150) if the result is shorter.
 * Takes the longer raw string to handle anti-aliased text on bright icon artwork.
 */

import { DIGIT_TEMPLATES, DigitTemplate } from './digit-templates';

const BRIGHT_THRESHOLD_STRICT = 180;
const BRIGHT_THRESHOLD_RELAXED = 150;
const MATCH_THRESHOLD = 0.80;

export function readTimerFromPixels(
    buffer: ImageData,
    ox: number,
    oy: number,
    scanDirection: 'up' | 'down' = 'up',
    gridSize: number = 30,
): { time: number; argText: string; rawStrict: string; rawRelaxed: string } {
    // Dual-threshold: run strict first, then relaxed, take longer raw string
    const strict = readTimerWithThreshold(buffer, ox, oy, scanDirection, gridSize, BRIGHT_THRESHOLD_STRICT);
    const relaxed = readTimerWithThreshold(buffer, ox, oy, scanDirection, gridSize, BRIGHT_THRESHOLD_RELAXED);

    // Take the result with the longer raw string (more complete read)
    // If equal length, prefer strict (cleaner threshold)
    if (relaxed.raw.length > strict.raw.length) {
        return { time: relaxed.time, argText: relaxed.argText, rawStrict: strict.raw, rawRelaxed: relaxed.raw };
    }
    return { time: strict.time, argText: strict.argText, rawStrict: strict.raw, rawRelaxed: relaxed.raw };
}

/**
 * Internal: read timer at a specific brightness threshold.
 */
function readTimerWithThreshold(
    buffer: ImageData,
    ox: number,
    oy: number,
    scanDirection: 'up' | 'down',
    gridSize: number,
    threshold: number,
): { time: number; argText: string; raw: string } {
    let time = 0;
    let argText = '';
    let raw = '';

    try {
        const scale = gridSize / 30;
        const scanW = Math.round(26 * scale);
        const startY = scanDirection === 'up'
            ? Math.max(0, oy - Math.round(8 * scale))
            : Math.max(0, oy);
        const endY = scanDirection === 'up'
            ? Math.min(buffer.height, oy + Math.round(2 * scale))
            : Math.min(buffer.height, oy + Math.round(14 * scale));
        const startX = Math.max(0, ox);
        const endX = Math.min(buffer.width, ox + scanW);

        const w = endX - startX, h = endY - startY;
        if (w <= 0 || h <= 0) return { time: 0, argText: '', raw: '' };

        // Build binary bitmap (1 = bright white, 0 = dark)
        const bmp: number[][] = [];
        for (let y = 0; y < h; y++) {
            const row: number[] = [];
            for (let x = 0; x < w; x++) {
                const i = ((startY + y) * buffer.width + (startX + x)) * 4;
                const r = buffer.data[i], g = buffer.data[i + 1], b = buffer.data[i + 2];
                row.push(
                    (r > threshold && g > threshold && b > threshold) ? 1 : 0
                );
            }
            bmp.push(row);
        }

        // Find densest 9-row text band
        let bestBandY = 0, bestBandScore = 0;
        for (let bandStart = 0; bandStart <= h - 5; bandStart++) {
            let score = 0;
            for (let y = bandStart; y < Math.min(bandStart + 9, h); y++) {
                for (const v of bmp[y]) if (v) score++;
            }
            if (score > bestBandScore) { bestBandScore = score; bestBandY = bandStart; }
        }
        if (bestBandScore < 5) return { time: 0, argText: '', raw: '' };

        const textTop = bestBandY;
        const textBottom = Math.min(bestBandY + 8, h - 1);

        // Sliding-window template matching
        raw = matchTemplates(bmp, w, textTop, textBottom);

        // Validate: only accept valid RS3 timer formats
        let match: RegExpMatchArray | null;
        if ((match = raw.match(/^(\d{1,2})m$/))) {
            time = parseInt(match[1]) * 60;
        } else if ((match = raw.match(/^(\d)hr$/i))) {
            time = parseInt(match[1]) * 3600;
        } else if ((match = raw.match(/^(\d{1,2})s$/i))) {
            time = parseInt(match[1]);
        } else if ((match = raw.match(/^(\d{1,2})%$/))) {
            argText = match[0];
        } else if ((match = raw.match(/^(\d{1,2})$/))) {
            time = parseInt(match[1]);
        }
        // Anything else is noise → time stays 0
    } catch (e) {
        console.log(`[DigitReader] Error: ${e}`);
    }

    return { time, argText, raw };
}

/**
 * Score a template placed at (bmpX, bmpY) against the bitmap.
 * Returns a score 0..1 where 1 = perfect match.
 * "Set" (1) pixels are weighted 2x vs "unset" (0) to reward hitting the template shape.
 */
function scoreTemplate(
    bmp: number[][],
    bmpX: number,
    bmpY: number,
    tpl: DigitTemplate,
): number {
    let setMatch = 0, setTotal = 0;
    let unsetMatch = 0, unsetTotal = 0;

    for (let y = 0; y < tpl.h; y++) {
        for (let x = 0; x < tpl.w; x++) {
            const by = bmpY + y, bx = bmpX + x;
            const tplBit = tpl.rows[y][x] === '1' ? 1 : 0;
            const bmpBit = (by >= 0 && by < bmp.length && bx >= 0 && bx < (bmp[0]?.length ?? 0))
                ? bmp[by][bx] : 0;

            if (tplBit === 1) {
                setTotal++;
                if (bmpBit === 1) setMatch++;
            } else {
                unsetTotal++;
                if (bmpBit === 0) unsetMatch++;
            }
        }
    }

    const total = 2 * setTotal + unsetTotal;
    const matched = 2 * setMatch + unsetMatch;
    return total > 0 ? matched / total : 0;
}

/**
 * Greedy left-to-right template matching across the text band.
 * Returns the recognized character string (e.g., "11m", "30", "5").
 */
function matchTemplates(
    bmp: number[][],
    bmpW: number,
    textTop: number,
    textBottom: number,
): string {
    // Find bright column bounds
    let firstX = -1, lastX = -1;
    for (let x = 0; x < bmpW; x++) {
        for (let y = textTop; y <= textBottom; y++) {
            if (bmp[y][x] === 1) {
                if (firstX < 0) firstX = x;
                lastX = x;
                break;
            }
        }
    }
    if (firstX < 0) return '';

    // Skip isolated thin columns at the left edge (border corner anti-aliasing).
    // Real text characters form runs of 3+ consecutive bright columns.
    // A 1-2px artifact before the text body can false-match as "1".
    let sustainedStart = firstX;
    let consecutive = 0;
    for (let sx = firstX; sx <= lastX; sx++) {
        let hasBright = false;
        for (let y = textTop; y <= textBottom; y++) {
            if (bmp[y][sx] === 1) { hasBright = true; break; }
        }
        if (hasBright) {
            if (consecutive === 0) sustainedStart = sx;
            consecutive++;
            if (consecutive >= 3) {
                firstX = sustainedStart;
                break;
            }
        } else {
            consecutive = 0;
        }
    }

    let result = '';
    let x = firstX;
    let guard = 0;

    while (x <= lastX && guard++ < 50) {
        let bestLabel = '';
        let bestScore = -1;
        let bestTplW = 0;

        for (const [label, variants] of Object.entries(DIGIT_TEMPLATES)) {
            for (const tpl of variants) {
                if (x + tpl.w > bmpW) continue;
                const score = scoreTemplate(bmp, x, textTop, tpl);
                if (score > bestScore) {
                    bestScore = score;
                    bestLabel = label;
                    bestTplW = tpl.w;
                }
            }
        }

        if (bestScore >= MATCH_THRESHOLD) {
            result += bestLabel;
            x += bestTplW;
            // Skip whitespace (empty cols) to next char
            while (x <= lastX) {
                let any = false;
                for (let y = textTop; y <= textBottom; y++) {
                    if (bmp[y][x] === 1) { any = true; break; }
                }
                if (any) break;
                x++;
            }
        } else {
            // No match at this position — advance past it
            x++;
        }
    }

    return result;
}
