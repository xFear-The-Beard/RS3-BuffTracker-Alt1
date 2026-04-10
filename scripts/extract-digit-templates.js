/**
 * Extracts labeled digit templates from calibration captures.
 * Outputs src/lib/digit-templates.ts with hardcoded bitmaps.
 *
 * Matches production scan geometry: oy=23, startY=15, endY=25 (10 rows).
 * Stores MULTIPLE templates per char (to cover antialiasing/kerning variants).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CAL_DIR = path.resolve(__dirname, '../../Icon Calibrations');
const UPPER_CAL_DIR = path.resolve(__dirname, '../../Dual_Text Timer - Icon Calibrations (Skeleton Warrior)');
const OUT_FILE = path.resolve(__dirname, '../src/lib/digit-templates.ts');
const BRIGHT_THRESHOLD = 180;

// Lower-left scan geometry (standard timer font, matches reader.ts lower-left read)
const SCAN_TOP = 15;
const SCAN_BOTTOM = 25;
const SCAN_LEFT = 0;
const SCAN_WIDTH = 26;

// Upper-left scan geometry (compact dual-text font, matches readDualTextTimer)
const UPPER_SCAN_TOP = 2;
const UPPER_SCAN_BOTTOM = 12;
const UPPER_SCAN_LEFT = 2;
const UPPER_SCAN_WIDTH = 26;

// Labeled captures (after correcting timer-7/9 to show both digits displayed)
// Source: Icon Calibrations/ — LOWER-LEFT timer text, standard font
const LABELED = [
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

// Upper-left dual-text timer captures (compact font, skeleton warrior with rage stacks)
// Source: Dual_Text Timer - Icon Calibrations (Skeleton Warrior)/
// These append as NEW VARIANTS alongside the lower-left LABELED extractions above.
// They do NOT replace or modify any lower-left templates.
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

async function loadIconBitmap(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const buf = Buffer.from(b64, 'base64');
    const { data, info } = await sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

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

/**
 * Segment: find runs of columns containing >=1 bright pixel within text band,
 * merging internal m-strokes (gap<=2, narrow neighbors).
 *
 * @param {string} passLabel 'lower' (existing rule) or 'upper' (tighter rule for compact font)
 */
function segmentChars(bmp, w, textTop, textBottom, passLabel) {
    const textH = textBottom - textTop + 1;

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

    // Merge m-strokes (narrow, small gap).
    // Only merge when the new segment is 1-2 cols wide — that's an m-stroke, not a digit.
    // Digit characters are all ≥3 cols wide in both lower-left (4-6) and upper-left (3-5)
    // fonts, so this rule never accidentally merges two adjacent digits.
    // No prev-width check — merge must chain across multiple m-strokes as prev grows.
    //
    // Note: lower-left "m" is usually one continuous segment (hump rows fill the gaps),
    // so this merge rarely fires for lower-left. Upper-left compact "m" has column-level
    // gaps between strokes and relies on this merge to assemble the full character.
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

function bitmapToRows(seg) {
    const rows = [];
    for (let y = 0; y < seg.h; y++) {
        let row = '';
        for (let x = 0; x < seg.w; x++) row += seg.cols[x][y] ? '1' : '0';
        rows.push(row);
    }
    return rows;
}

/**
 * Trim empty leading/trailing columns. Preserves full 9-row height.
 */
function trimTemplate(rows, w, h) {
    // Find first/last col with any set pixel
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

/**
 * Process one labeled calibration pass (either lower-left or upper-left).
 * Extracts segmented character templates and adds them to templatesByLabel as new variants.
 */
async function processPass(labeled, calDir, scanTop, scanBottom, scanLeft, scanWidth, templatesByLabel, allSamples, failures, passLabel) {
    for (const [filename, iconIdx, expectedText, desc] of labeled) {
        const filepath = path.join(calDir, filename);
        if (!fs.existsSync(filepath)) { failures.push(`[${passLabel}] NOT FOUND ${filename}`); continue; }
        const cal = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        const icon = cal.icons[iconIdx];
        if (!icon) { failures.push(`[${passLabel}] MISSING ${filename}#${iconIdx}`); continue; }

        const img = await loadIconBitmap(icon.dataUrl);
        const { bmp, w, h } = buildBrightBitmap(img, scanTop, scanBottom, scanLeft, scanWidth);
        const { textTop, textBottom, score } = findTextBand(bmp, h);
        if (score < 5) { failures.push(`[${passLabel}] NO TEXT ${desc}`); continue; }

        const segments = segmentChars(bmp, w, textTop, textBottom, passLabel);
        const expectedChars = expectedText.split('');

        if (segments.length !== expectedChars.length) {
            failures.push(`[${passLabel}] SEGMENT MISMATCH ${desc}: expected ${expectedChars.length} (${expectedText}), got ${segments.length}`);
            continue;
        }

        for (let i = 0; i < segments.length; i++) {
            const label = expectedChars[i];
            const seg = segments[i];
            const rawRows = bitmapToRows(seg);
            const trimmed = trimTemplate(rawRows, seg.w, seg.h);
            const source = `${passLabel}:${filename}#${iconIdx}:${i}`;
            allSamples.push({ label, ...trimmed, source });

            if (!templatesByLabel[label]) templatesByLabel[label] = [];
            // Dedupe: only add if not identical to an existing template for this label
            const isDup = templatesByLabel[label].some(t =>
                t.w === trimmed.w && t.h === trimmed.h &&
                t.rows.every((r, idx) => r === trimmed.rows[idx])
            );
            if (!isDup) {
                templatesByLabel[label].push({ ...trimmed, source });
            }
        }
    }
}

async function main() {
    const templatesByLabel = {}; // label -> [{ rows, w, h, source }...]
    const allSamples = [];
    const failures = [];

    // Pass 1: LOWER-LEFT (standard timer font) — unchanged behavior
    await processPass(LABELED, CAL_DIR, SCAN_TOP, SCAN_BOTTOM, SCAN_LEFT, SCAN_WIDTH, templatesByLabel, allSamples, failures, 'lower');

    // Pass 2: UPPER-LEFT (compact dual-text font, skeleton warrior) — additive variants
    await processPass(LABELED_UPPER, UPPER_CAL_DIR, UPPER_SCAN_TOP, UPPER_SCAN_BOTTOM, UPPER_SCAN_LEFT, UPPER_SCAN_WIDTH, templatesByLabel, allSamples, failures, 'upper');

    // Report coverage
    console.log('=== Template Coverage ===');
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

    console.log('\n=== Templates (ASCII) ===');
    for (const ch of allChars) {
        const variants = templatesByLabel[ch];
        if (!variants) continue;
        for (let vi = 0; vi < variants.length; vi++) {
            console.log(`'${ch}' variant ${vi} (${variants[vi].w}x${variants[vi].h}):`);
            for (const row of variants[vi].rows) {
                console.log('  ' + row.replace(/1/g, '#').replace(/0/g, '.'));
            }
        }
    }

    if (failures.length > 0) {
        console.log('\n=== Failures ===');
        for (const f of failures) console.log('  ' + f);
    }

    // Emit TS module
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

    fs.writeFileSync(OUT_FILE, tsLines.join('\n'));
    const variantCount = Object.values(templatesByLabel).reduce((a, v) => a + v.length, 0);
    console.log(`\nWrote ${OUT_FILE}`);
    console.log(`  ${Object.keys(templatesByLabel).length} labels, ${variantCount} total variants, ${allSamples.length} samples, ${failures.length} failures`);
}

main().catch(e => { console.error(e); process.exit(1); });
