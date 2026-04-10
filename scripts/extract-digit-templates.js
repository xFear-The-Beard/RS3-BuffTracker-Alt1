/**
 * Extracts labeled digit templates from calibration captures.
 *
 * Two FULLY INDEPENDENT extraction passes:
 *   1. LOWER-LEFT (standard timer font)  → src/lib/digit-templates.ts
 *      Output: DIGIT_TEMPLATES used by digit-reader.ts
 *      Uses original segmentation rule (prevW<=4 && seg.w<=4) — must produce
 *      output byte-identical to the initial release of digit-templates.ts.
 *
 *   2. UPPER-LEFT (compact dual-text font, skeleton warrior with rage stacks)
 *      → src/lib/digit-templates-upper.ts
 *      Output: UPPER_DIGIT_TEMPLATES used by digit-reader-upper.ts
 *      Uses tighter compact-font rule (seg.w<=2, no prevW check).
 *
 * The two passes share NO segmentation code, NO output file, NO export name.
 * Lower-left can be regenerated freely without affecting any upper-left state
 * and vice versa.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ============================================================================
// SHARED PURE HELPERS (image decoding only — no segmentation logic)
// ============================================================================

const BRIGHT_THRESHOLD = 180;

async function loadIconBitmap(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const buf = Buffer.from(b64, 'base64');
    const { data, info } = await sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

/**
 * Pure image-region-to-binary-bitmap conversion. No segmentation, no font logic.
 * Reads pixels from (scanLeft..scanLeft+scanWidth) x (scanTop..scanBottom) and
 * returns a 2D boolean array of bright vs dark.
 */
function buildBrightBitmap(img, scanTop, scanBottom, scanLeft, scanWidth) {
    const endY = Math.min(scanBottom, img.height);
    const h = endY - scanTop;
    const w = scanWidth;
    const bmp = [];
    for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
            const srcY = scanTop + y;
            const srcX = scanLeft + x;
            if (srcX >= img.width) { row.push(false); continue; }
            const i = (srcY * img.width + srcX) * 4;
            const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
            row.push(r > BRIGHT_THRESHOLD && g > BRIGHT_THRESHOLD && b > BRIGHT_THRESHOLD);
        }
        bmp.push(row);
    }
    return { bmp, w, h };
}

function findTextBand(bmp, h) {
    let bestBandY = 0, bestBandScore = 0;
    for (let bandStart = 0; bandStart <= h - 5; bandStart++) {
        let score = 0;
        for (let y = bandStart; y < Math.min(bandStart + 9, h); y++) {
            score += bmp[y].filter(v => v).length;
        }
        if (score > bestBandScore) { bestBandScore = score; bestBandY = bandStart; }
    }
    return { textTop: bestBandY, textBottom: Math.min(bestBandY + 8, h - 1), score: bestBandScore };
}

function bitmapToRows(seg) {
    const rows = [];
    for (let y = 0; y < seg.h; y++) {
        let row = '';
        for (let x = 0; x < seg.w; x++) row += seg.cols[x][y] ? '1' : '0';
        rows.push(row);
    }
    return rows;
}

function trimTemplate(rows, w, h) {
    let firstCol = w, lastCol = -1;
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            if (rows[y][x] === '1') {
                if (x < firstCol) firstCol = x;
                if (x > lastCol) lastCol = x;
                break;
            }
        }
    }
    if (firstCol > lastCol) return { rows, w, h };
    const newW = lastCol - firstCol + 1;
    const newRows = rows.map(r => r.substring(firstCol, lastCol + 1));
    return { rows: newRows, w: newW, h };
}

function rawSegmentColumns(bmp, w, textTop, textBottom) {
    const colCounts = [];
    for (let x = 0; x < w; x++) {
        let c = 0;
        for (let y = textTop; y <= textBottom; y++) if (bmp[y][x]) c++;
        colCounts.push(c);
    }
    const rawSegments = [];
    let inChar = false, charStart = 0;
    for (let x = 0; x <= w; x++) {
        const has = x < w && colCounts[x] >= 1;
        if (has && !inChar) { charStart = x; inChar = true; }
        else if (!has && inChar) {
            rawSegments.push({ start: charStart, end: x, w: x - charStart });
            inChar = false;
        }
    }
    return rawSegments;
}

function segmentsToTemplates(merged, bmp, textTop, textBottom) {
    const textH = textBottom - textTop + 1;
    const segments = merged.map(s => {
        const cols = [];
        for (let cx = s.start; cx < s.end; cx++) {
            const col = [];
            for (let y = textTop; y <= textBottom; y++) col.push(bmp[y][cx] ? 1 : 0);
            cols.push(col);
        }
        return { w: s.end - s.start, h: textH, cols, start: s.start };
    });
    return segments.filter(s => {
        const total = s.cols.reduce((sum, c) => sum + c.reduce((a, b) => a + b, 0), 0);
        return total >= 3;
    });
}

// ============================================================================
// LOWER-LEFT PASS (standard timer font) — DO NOT MODIFY without verifying
// byte-identical output to digit-templates.ts at commit 098471e.
// ============================================================================

const LOWER_CAL_DIR = path.resolve(__dirname, '../../Icon Calibrations');
const LOWER_OUT_FILE = path.resolve(__dirname, '../src/lib/digit-templates.ts');

const LOWER_SCAN_TOP = 15;
const LOWER_SCAN_BOTTOM = 25;
const LOWER_SCAN_LEFT = 0;
const LOWER_SCAN_WIDTH = 26;

const LABELED_LOWER = [
    ['buff-calibration1.json', 3, '11m', 'Darkness'],
    ['buff-calibration1.json', 1, '1m', 'Putrid Zombie'],
    ['buff-calibration-for-timers.json', 0, '3', 'Death Spark'],
    ['buff-calibration-for-timers.json', 2, '48', 'Vengeful Ghost'],
    ['buff-calibration-for-timers.json', 3, '4', 'Residual Soul'],
    ['buff-calibration-for-timers.json', 4, '12', 'Necrosis'],
    ['buff-calibration-for-timers.json', 5, '25', 'Bone Shield'],
    ['buff-calibration-for-timers.json', 6, '30', 'Reaper Necklace'],
    ['buff-calibration-timer-7.json', 0, '37', 'Vengeful Ghost (37)'],
    ['buff-calibration-timer-9.json', 0, '59', 'Vengeful Ghost (59)'],
    ['buff-calibration-timer-6-%.json', 0, '6%', 'Clan Avatar XP Boost'],
];

/**
 * LOWER-LEFT segmentation. Original merge rule:
 *   gap<=2 && prevW<=4 && seg.w<=4
 * This is the rule that produced the committed digit-templates.ts at 098471e.
 * Do not change this function — its output is what live lower-left matching depends on.
 */
function segmentCharsLower(bmp, w, textTop, textBottom) {
    const rawSegments = rawSegmentColumns(bmp, w, textTop, textBottom);

    // Merge m-strokes (narrow, small gap) — original rule with prevW check.
    const merged = [];
    for (const seg of rawSegments) {
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            const gap = seg.start - prev.end;
            const prevW = prev.end - prev.start;
            if (gap <= 2 && prevW <= 4 && seg.w <= 4) {
                prev.end = seg.end;
                prev.w = prev.end - prev.start;
                continue;
            }
        }
        merged.push({ ...seg });
    }

    return segmentsToTemplates(merged, bmp, textTop, textBottom);
}

async function extractLower() {
    const templatesByLabel = {};
    const allSamples = [];
    const failures = [];

    for (const [filename, iconIdx, expectedText, desc] of LABELED_LOWER) {
        const filepath = path.join(LOWER_CAL_DIR, filename);
        if (!fs.existsSync(filepath)) { failures.push(`NOT FOUND ${filename}`); continue; }
        const cal = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        const icon = cal.icons[iconIdx];
        if (!icon) { failures.push(`MISSING ${filename}#${iconIdx}`); continue; }

        const img = await loadIconBitmap(icon.dataUrl);
        const { bmp, w, h } = buildBrightBitmap(img, LOWER_SCAN_TOP, LOWER_SCAN_BOTTOM, LOWER_SCAN_LEFT, LOWER_SCAN_WIDTH);
        const { textTop, textBottom, score } = findTextBand(bmp, h);
        if (score < 5) { failures.push(`NO TEXT ${desc}`); continue; }

        const segments = segmentCharsLower(bmp, w, textTop, textBottom);
        const expectedChars = expectedText.split('');

        if (segments.length !== expectedChars.length) {
            failures.push(`SEGMENT MISMATCH ${desc}: expected ${expectedChars.length} (${expectedText}), got ${segments.length}`);
            continue;
        }

        for (let i = 0; i < segments.length; i++) {
            const label = expectedChars[i];
            const seg = segments[i];
            const rawRows = bitmapToRows(seg);
            const trimmed = trimTemplate(rawRows, seg.w, seg.h);
            const source = `${filename}#${iconIdx}:${i}`;
            allSamples.push({ label, ...trimmed, source });

            if (!templatesByLabel[label]) templatesByLabel[label] = [];
            const isDup = templatesByLabel[label].some(t =>
                t.w === trimmed.w && t.h === trimmed.h &&
                t.rows.every((r, idx) => r === trimmed.rows[idx])
            );
            if (!isDup) {
                templatesByLabel[label].push({ ...trimmed, source });
            }
        }
    }

    return { templatesByLabel, allSamples, failures };
}

function emitLowerTs(templatesByLabel) {
    const tsLines = [
        '// AUTO-GENERATED by scripts/extract-digit-templates.js',
        '// Pixel templates for RS3 buff-bar digits, trimmed to tight column bounds.',
        '// Multiple variants per char capture antialiasing/kerning differences.',
        '',
        'export interface DigitTemplate {',
        '    /** Width in pixels (after trim) */',
        '    w: number;',
        '    /** Height in pixels (constant = text band height) */',
        '    h: number;',
        '    /** Row-major: rows[y] is a string of "1"/"0" of length w */',
        '    rows: string[];',
        '}',
        '',
        '/** Templates keyed by character — each char may have multiple variants */',
        'export const DIGIT_TEMPLATES: Record<string, DigitTemplate[]> = {',
    ];
    for (const [label, variants] of Object.entries(templatesByLabel)) {
        tsLines.push(`    ${JSON.stringify(label)}: [`);
        for (const v of variants) {
            tsLines.push(`        {`);
            tsLines.push(`            w: ${v.w},`);
            tsLines.push(`            h: ${v.h},`);
            tsLines.push(`            rows: [`);
            for (const r of v.rows) tsLines.push(`                ${JSON.stringify(r)},`);
            tsLines.push(`            ],`);
            tsLines.push(`        },`);
        }
        tsLines.push(`    ],`);
    }
    tsLines.push('};');
    tsLines.push('');
    fs.writeFileSync(LOWER_OUT_FILE, tsLines.join('\n'));
}

// ============================================================================
// UPPER-LEFT PASS (compact dual-text font) — completely independent of lower
// ============================================================================

const UPPER_CAL_DIR = path.resolve(__dirname, '../../Dual_Text Timer - Icon Calibrations (Skeleton Warrior)');
const UPPER_OUT_FILE = path.resolve(__dirname, '../src/lib/digit-templates-upper.ts');

const UPPER_SCAN_TOP = 2;
const UPPER_SCAN_BOTTOM = 12;
const UPPER_SCAN_LEFT = 2;
const UPPER_SCAN_WIDTH = 26;

const LABELED_UPPER = [
    ['buff-calibration-skeleton-upper-1m.json', 0, '1m', 'Skeleton upper 1m'],
    ['buff-calibration-skeleton-upper-58.json', 0, '58', 'Skeleton upper 58'],
    ['buff-calibration-skeleton-upper-54.json', 0, '54', 'Skeleton upper 54'],
    ['buff-calibration-skeleton-upper-40.json', 0, '40', 'Skeleton upper 40'],
    ['buff-calibration-skeleton-upper-33.json', 0, '33', 'Skeleton upper 33'],
    ['buff-calibration-skeleton-upper-29.json', 0, '29', 'Skeleton upper 29'],
    ['buff-calibration-skeleton-upper-17.json', 0, '17', 'Skeleton upper 17'],
    ['buff-calibration-skeleton-upper-16.json', 0, '16', 'Skeleton upper 16'],
    ['buff-calibration-skeleton-upper-9.json', 0, '9', 'Skeleton upper 9'],
];

/**
 * UPPER-LEFT compact-font segmentation. Tight merge rule:
 *   gap<=2 && seg.w<=2  (no prevW check)
 *
 * Compact-font digits are 3-5 cols wide, so seg.w<=2 only fires for true
 * m-strokes (1 col wide). No prevW check is needed because the merge must
 * chain across multiple m-strokes as prev grows past 4 cols.
 *
 * This function is exclusive to upper-left extraction. It does not affect,
 * and is not affected by, segmentCharsLower.
 */
function segmentCharsCompact(bmp, w, textTop, textBottom) {
    const rawSegments = rawSegmentColumns(bmp, w, textTop, textBottom);

    const merged = [];
    for (const seg of rawSegments) {
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            const gap = seg.start - prev.end;
            if (gap <= 2 && seg.w <= 2) {
                prev.end = seg.end;
                prev.w = prev.end - prev.start;
                continue;
            }
        }
        merged.push({ ...seg });
    }

    return segmentsToTemplates(merged, bmp, textTop, textBottom);
}

async function extractUpper() {
    const templatesByLabel = {};
    const allSamples = [];
    const failures = [];

    for (const [filename, iconIdx, expectedText, desc] of LABELED_UPPER) {
        const filepath = path.join(UPPER_CAL_DIR, filename);
        if (!fs.existsSync(filepath)) { failures.push(`NOT FOUND ${filename}`); continue; }
        const cal = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        const icon = cal.icons[iconIdx];
        if (!icon) { failures.push(`MISSING ${filename}#${iconIdx}`); continue; }

        const img = await loadIconBitmap(icon.dataUrl);
        const { bmp, w, h } = buildBrightBitmap(img, UPPER_SCAN_TOP, UPPER_SCAN_BOTTOM, UPPER_SCAN_LEFT, UPPER_SCAN_WIDTH);
        const { textTop, textBottom, score } = findTextBand(bmp, h);
        if (score < 5) { failures.push(`NO TEXT ${desc}`); continue; }

        const segments = segmentCharsCompact(bmp, w, textTop, textBottom);
        const expectedChars = expectedText.split('');

        if (segments.length !== expectedChars.length) {
            failures.push(`SEGMENT MISMATCH ${desc}: expected ${expectedChars.length} (${expectedText}), got ${segments.length}`);
            continue;
        }

        for (let i = 0; i < segments.length; i++) {
            const label = expectedChars[i];
            const seg = segments[i];
            const rawRows = bitmapToRows(seg);
            const trimmed = trimTemplate(rawRows, seg.w, seg.h);
            const source = `${filename}#${iconIdx}:${i}`;
            allSamples.push({ label, ...trimmed, source });

            if (!templatesByLabel[label]) templatesByLabel[label] = [];
            const isDup = templatesByLabel[label].some(t =>
                t.w === trimmed.w && t.h === trimmed.h &&
                t.rows.every((r, idx) => r === trimmed.rows[idx])
            );
            if (!isDup) {
                templatesByLabel[label].push({ ...trimmed, source });
            }
        }
    }

    return { templatesByLabel, allSamples, failures };
}

function emitUpperTs(templatesByLabel) {
    const tsLines = [
        '// AUTO-GENERATED by scripts/extract-digit-templates.js (upper-left pass)',
        '// Compact pixel templates for RS3 dual-text upper-left timer text.',
        '// Used by digit-reader-upper.ts only — completely independent of DIGIT_TEMPLATES.',
        '',
        'export interface UpperDigitTemplate {',
        '    /** Width in pixels (after trim) */',
        '    w: number;',
        '    /** Height in pixels (constant = text band height) */',
        '    h: number;',
        '    /** Row-major: rows[y] is a string of "1"/"0" of length w */',
        '    rows: string[];',
        '}',
        '',
        '/** Compact templates keyed by character — each char may have multiple variants */',
        'export const UPPER_DIGIT_TEMPLATES: Record<string, UpperDigitTemplate[]> = {',
    ];
    for (const [label, variants] of Object.entries(templatesByLabel)) {
        tsLines.push(`    ${JSON.stringify(label)}: [`);
        for (const v of variants) {
            tsLines.push(`        {`);
            tsLines.push(`            w: ${v.w},`);
            tsLines.push(`            h: ${v.h},`);
            tsLines.push(`            rows: [`);
            for (const r of v.rows) tsLines.push(`                ${JSON.stringify(r)},`);
            tsLines.push(`            ],`);
            tsLines.push(`        },`);
        }
        tsLines.push(`    ],`);
    }
    tsLines.push('};');
    tsLines.push('');
    fs.writeFileSync(UPPER_OUT_FILE, tsLines.join('\n'));
}

// ============================================================================
// MAIN — runs both passes independently
// ============================================================================

function reportPass(name, templatesByLabel, allSamples, failures) {
    console.log(`\n=== ${name} Coverage ===`);
    const allChars = '0123456789ms%hr';
    for (const ch of allChars) {
        const variants = templatesByLabel[ch];
        if (variants && variants.length > 0) {
            console.log(`  '${ch}': ${variants.length} variant(s)`);
            for (const v of variants) console.log(`    ${v.w}x${v.h}  from ${v.source}`);
        } else {
            console.log(`  '${ch}': MISSING`);
        }
    }
    if (failures.length > 0) {
        console.log(`\n=== ${name} Failures ===`);
        for (const f of failures) console.log('  ' + f);
    }
    const variantCount = Object.values(templatesByLabel).reduce((a, v) => a + v.length, 0);
    console.log(`\n${name}: ${Object.keys(templatesByLabel).length} labels, ${variantCount} variants, ${allSamples.length} samples, ${failures.length} failures`);
}

async function main() {
    // PASS 1: lower-left (independent)
    const lower = await extractLower();
    reportPass('LOWER', lower.templatesByLabel, lower.allSamples, lower.failures);
    emitLowerTs(lower.templatesByLabel);
    console.log(`Wrote ${LOWER_OUT_FILE}`);

    // PASS 2: upper-left (independent)
    const upper = await extractUpper();
    reportPass('UPPER', upper.templatesByLabel, upper.allSamples, upper.failures);
    emitUpperTs(upper.templatesByLabel);
    console.log(`Wrote ${UPPER_OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
