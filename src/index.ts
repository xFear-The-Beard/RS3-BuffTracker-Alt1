import * as a1lib from 'alt1';
import { detectBars, detectBar, detectBarFromClick, expandEnemyBarRegion, getRsScaling } from './lib/detector';
import { BuffBarReader, compareBuffIcons } from './lib/reader';
import { readUpperTimerFromPixels } from './lib/digit-reader-upper';
import { loadCalibration, saveCalibration, clearCalibration, createCalibration, isCalibrationStale } from './lib/calibrator';
import { BarRegion, BuffSlot, DetectionResult } from './lib/types';
import { store } from './ui/store';
import { COMBAT_STYLES, CombatStyle, getStyleDef } from './data/abilities';
import { getRefImages, loadAllRefImages } from './data/icon-loader';
import { ModernRenderer } from './ui/renderers/modern-renderer';
import { CompactRenderer } from './ui/renderers/compact-renderer';
import { ClassicRenderer } from './ui/renderers/classic-renderer';
import { ThemedRenderer } from './ui/renderers/themed-renderer';
import { ThemedFramesRenderer } from './ui/renderers/themed-frames-renderer';
import { CombatBuffsRenderer } from './ui/renderers/combat-buffs-renderer';
import { OverlayManager } from './ui/overlay-manager';
import { OverlayRenderer } from './ui/renderer';
import { initSettings, renderSettings, setDebugModeToggleCallback, getDebugModeEnabled } from './ui/settings';
import { setDebugLogEnabled } from './lib/debug';
import { alarmManager } from './ui/alarm-manager';

// Import static assets so webpack copies them to dist
import './index.html';
import './appconfig.json';
import './css/styles.css';
import './icon.png';

// --- Polling interval ---
const POLL_INTERVAL_MS = 200;

// --- Renderers ---
let gaugeRenderer: OverlayRenderer;
let combatBuffsRenderer: CombatBuffsRenderer;
let overlayManager: OverlayManager | null = null;
let currentRendererStyle: string = 'modern';

/**
 * Create the appropriate gauge renderer for the selected overlay style.
 */
function createGaugeRenderer(style: string): OverlayRenderer {
    switch (style) {
        case 'compact': return new CompactRenderer();
        case 'classic': return new ClassicRenderer();
        case 'modern': return new ModernRenderer();
        case 'themed': return new ThemedRenderer();
        case 'themed-frames': return new ThemedFramesRenderer();
        default: return new ModernRenderer();
    }
}

// --- App State ---
let buffReader: BuffBarReader | null = null;
let debuffReader: BuffBarReader | null = null;
let enemyReader: BuffBarReader | null = null;
let lastBuffBuffer: ImageData | null = null;
/** Internal timer for Bloat: starts at 20.5s when first detected, counts down */
let bloatTimer: { active: boolean; remaining: number; interval: ReturnType<typeof setInterval> | null } = { active: false, remaining: 0, interval: null };
let readInterval: ReturnType<typeof setInterval> | null = null;

// Diagnostic heartbeat state. Fires every 60s while debug mode is on, logs a single
// line summarizing heap, subscribers, DOM size, session frames, cycle count, uptime.
// Used to spot memory leaks and resource accumulation in long sessions.
let diagInterval: ReturnType<typeof setInterval> | null = null;
const APP_START_TIME = Date.now();
const DIAG_INTERVAL_MS = 60000;
let debugMode = getDebugModeEnabled();
setDebugLogEnabled(debugMode);
let debugPaused = false;
let pixelDumpDone = false;
let isRunning = false;
let settingsOpen = false;

// --- DOM Helpers ---
const statusText = () => document.getElementById('status-text')!;
const statusDot = () => document.getElementById('status-dot')!;
const debugOutput = () => document.getElementById('debug-output')!;

// --- Session Recording ---
let sessionRecording = false;
const sessionFrames: Array<{
    timestamp: number;
    slots: Array<{
        column: number;
        row: number;
        isDebuff: boolean;
        time: number;
        altTime: number;
        argText: string;
        pixels: number[];
    }>;
}> = [];

// --- Debug UI Injection ---

/**
 * Inject all debug UI elements into the DOM (called when debugMode is enabled).
 */
function injectDebugUI(): void {
    const container = document.getElementById('debug-container');
    if (!container) return;
    // Don't double-inject
    if (document.getElementById('debug-output')) return;

    container.classList.add('active');
    container.innerHTML = `
        <div id="debug-output"></div>
        <div id="debug-controls">
            <button id="btn-debug-pause">Pause Log</button>
            <button id="btn-debug-clear">Clear</button>
            <button id="btn-export-log">Export Log</button>
            <button id="btn-capture-icons">Capture Buff Icons</button>
            <button id="btn-record-session">Record Session</button>
        </div>
        <div id="captured-icons" style="display:none; margin-top:8px; padding:8px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:4px;">
            <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-bottom:6px;">Captured icons from your buff bar (screenshot these for me):</div>
            <div id="captured-icons-grid" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
        </div>
    `;

    wireDebugButtons();
}

/**
 * Remove all debug UI elements from the DOM (called when debugMode is disabled).
 */
function removeDebugUI(): void {
    const container = document.getElementById('debug-container');
    if (container) {
        container.innerHTML = '';
        container.classList.remove('active');
    }
    sessionRecording = false;
}

/**
 * Wire event handlers for debug UI buttons.
 * Called after injecting the debug UI DOM elements.
 */
function wireDebugButtons(): void {
    document.getElementById('btn-debug-pause')?.addEventListener('click', () => {
        debugPaused = !debugPaused;
        const btn = document.getElementById('btn-debug-pause');
        if (btn) btn.textContent = debugPaused ? 'Resume Log' : 'Pause Log';
    });
    document.getElementById('btn-debug-clear')?.addEventListener('click', () => {
        const el = debugOutput();
        if (el) el.innerHTML = '';
    });
    document.getElementById('btn-export-log')?.addEventListener('click', () => {
        const el = debugOutput();
        if (!el) return;
        const lines = Array.from(el.children).map(c => c.textContent || '').join('\n');
        const blob = new Blob([lines], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `buff-tracker-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    });
    document.getElementById('btn-record-session')?.addEventListener('click', () => {
        const btn = document.getElementById('btn-record-session')!;
        if (!sessionRecording) {
            sessionRecording = true;
            sessionFrames.length = 0;
            btn.textContent = 'Stop Recording';
            btn.style.color = '#f87171';
            log('Session recording started', 'info');
        } else {
            stopAndExportSession();
        }
    });

    // Capture icons button wiring is handled separately since it's complex
    wireCaptureIconsButton();
}

/**
 * Stop recording and export session data as JSON.
 */
function stopAndExportSession(): void {
    sessionRecording = false;
    const btn = document.getElementById('btn-record-session');
    if (btn) {
        btn.textContent = 'Record Session';
        btn.style.color = '';
    }
    const json = JSON.stringify({ recorded: new Date().toISOString(), frames: sessionFrames }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log(`Session recording saved — ${sessionFrames.length} frames`, 'info');
}

/**
 * Wire the Capture Buff Icons button (complex — extracted from init).
 */
function wireCaptureIconsButton(): void {
    document.getElementById('btn-capture-icons')?.addEventListener('click', () => {
        if (!buffReader && !debuffReader && !enemyReader) {
            log('No bars detected yet. Click Detect first.', 'warn');
            return;
        }

        const grid = document.getElementById('captured-icons-grid')!;
        const container = document.getElementById('captured-icons')!;
        grid.innerHTML = '';
        container.style.display = '';

        // Remove old export button
        document.getElementById('btn-export-calibration')?.remove();

        const capturedIcons: Array<{ canvas: HTMLCanvasElement; input: HTMLInputElement; type: string }> = [];
        let capturedCount = 0;

        const addIcon = (slot: BuffSlot, barType: string) => {
            if (!slot.iconData) return;
            const canvas = document.createElement('canvas');
            canvas.width = slot.iconData.width;
            canvas.height = slot.iconData.height;
            const ctx = canvas.getContext('2d')!;
            ctx.putImageData(slot.iconData, 0, 0);

            const card = document.createElement('div');
            card.style.cssText = 'text-align:center; margin-bottom:4px;';
            canvas.style.cssText = 'image-rendering:pixelated; border:1px solid rgba(255,255,255,0.2); width:54px; height:54px;';
            card.appendChild(canvas);

            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Name this buff...';
            input.style.cssText = 'width:80px; padding:2px 4px; font-size:9px; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.15); border-radius:3px; color:#e0e0e0; margin-top:3px;';
            card.appendChild(input);

            const typeLabel = document.createElement('div');
            typeLabel.style.cssText = 'font-size:8px; color:rgba(255,255,255,0.2); margin-top:1px;';
            typeLabel.textContent = `${barType} #${capturedCount} (${slot.iconData.width}x${slot.iconData.height})`;
            card.appendChild(typeLabel);

            grid.appendChild(card);
            capturedIcons.push({ canvas, input, type: barType });
            capturedCount++;
        };

        if (buffReader) {
            const buffs = buffReader.read();
            for (const slot of buffs) addIcon(slot, 'buff');
        }
        if (debuffReader) {
            const debuffs = debuffReader.read();
            for (const slot of debuffs) addIcon(slot, 'debuff');
        }
        if (enemyReader) {
            const enemySlots = enemyReader.read();
            for (const slot of enemySlots) addIcon(slot, 'enemy');
        }

        log(`Captured ${capturedCount} icons from buff/debuff/enemy bars`, 'info');

        if (capturedCount === 0) {
            grid.innerHTML = '<div style="font-size:10px; color:rgba(255,255,255,0.3);">No active buffs detected. Make sure you have buffs active on your buff bar.</div>';
            return;
        }

        const exportBtn = document.createElement('button');
        exportBtn.id = 'btn-export-calibration';
        exportBtn.textContent = 'Export Named Icons (JSON)';
        exportBtn.style.cssText = 'width:100%; padding:6px; margin-top:8px; font-size:11px; font-weight:500; border:1px solid rgba(34,197,94,0.4); border-radius:4px; background:rgba(34,197,94,0.12); color:#86efac; cursor:pointer;';
        exportBtn.addEventListener('click', () => {
            const entries: Array<{ name: string; type: string; width: number; height: number; dataUrl: string }> = [];

            for (const { canvas, input, type } of capturedIcons) {
                const name = input.value.trim();
                if (!name) continue;
                entries.push({
                    name,
                    type,
                    width: canvas.width,
                    height: canvas.height,
                    dataUrl: canvas.toDataURL('image/png'),
                });
            }

            if (entries.length === 0) {
                log('No icons named. Type a name under each icon before exporting.', 'warn');
                return;
            }

            const json = JSON.stringify({ captured: new Date().toISOString(), icons: entries }, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'buff-calibration.json';
            a.click();
            URL.revokeObjectURL(url);

            log(`Exported ${entries.length} named icons to buff-calibration.json`, 'info');
        });
        container.appendChild(exportBtn);
    });
}

// --- Logging ---
function log(msg: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info'): void {
    const prefix = `[BuffTracker]`;
    switch (level) {
        case 'error': console.error(prefix, msg); break;
        case 'warn': console.warn(prefix, msg); break;
        case 'debug': if (debugMode) console.log(prefix, msg); break;
        default: console.log(prefix, msg);
    }

    if (debugMode && !debugPaused) {
        const el = debugOutput();
        if (el) {
            const line = document.createElement('div');
            line.textContent = `${new Date().toLocaleTimeString()} [${level}] ${msg}`;
            el.appendChild(line);
            // Keep only last 5000 lines (~50 minutes of normal-rate logging)
            while (el.childElementCount > 5000) {
                el.removeChild(el.firstChild!);
            }
            el.scrollTop = el.scrollHeight;
        }
    }
}

function setStatus(msg: string, level: 'ok' | 'warn' | 'error' | 'info' = 'info'): void {
    const textEl = statusText();
    const dotEl = statusDot();
    if (textEl) {
        textEl.textContent = msg;
    }
    if (dotEl) {
        dotEl.className = level;
    }
    log(msg, level === 'ok' ? 'info' : level);
}

/**
 * Inject the "Hide All Overlays" master kill switch into the #status bar.
 *
 * Always visible (status bar shows on both the main panels view and the
 * Settings view), placed far right. Slider checked = all overlays hidden,
 * regardless of individual panel visibility. Per-panel visible state is
 * preserved so flipping the slider back unchecked restores exactly what
 * was visible before — panels that were individually hidden stay hidden,
 * panels that were on come back on.
 */
function installMasterOverlayToggle(): void {
    const statusBar = document.getElementById('status');
    if (!statusBar) return;

    // Convert the status bar into a flex row so the toggle can right-align
    // without disturbing the existing dot+text markup.
    statusBar.style.display = 'flex';
    statusBar.style.alignItems = 'center';
    statusBar.style.justifyContent = 'space-between';
    statusBar.style.gap = '10px';

    // Group the original dot+text together on the left so they continue to
    // behave as a single status indicator unit.
    const dotEl = document.getElementById('status-dot');
    const textEl = document.getElementById('status-text');
    if (dotEl && textEl && dotEl.parentElement === statusBar) {
        const leftGroup = document.createElement('div');
        leftGroup.style.cssText = 'display:flex; align-items:center; gap:6px; flex:1; min-width:0;';
        statusBar.insertBefore(leftGroup, dotEl);
        leftGroup.appendChild(dotEl);
        leftGroup.appendChild(textEl);
    }

    // Right side: descriptive label + master kill-switch slider.
    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex; align-items:center; gap:8px; flex-shrink:0;';
    rightGroup.innerHTML = `
        <span style="font-size:10px; color:rgba(255,255,255,0.6);">Hide All Overlays On/Off</span>
        <label class="settings-toggle-switch" title="Master kill switch — hide all overlay panels at once. Per-panel state is remembered.">
            <input type="checkbox" id="master-overlay-toggle" ${store.getState().masterOverlayHidden ? 'checked' : ''}>
            <span class="settings-toggle-slider"></span>
        </label>
    `;
    statusBar.appendChild(rightGroup);

    const checkbox = document.getElementById('master-overlay-toggle') as HTMLInputElement | null;
    if (!checkbox) return;

    checkbox.addEventListener('change', () => {
        store.setMasterOverlayHidden(checkbox.checked);
        // In browser/HTML mode renderPanelsToHTML is the subscriber that
        // updates display style. In Alt1 mode the overlay-manager subscriber
        // handles it. Either way the store notify above triggers them.
    });

    // Keep the checkbox in sync if state is loaded from storage or changed
    // from elsewhere (currently nothing else mutates this, but future-proof).
    store.subscribe((state) => {
        if (checkbox.checked !== state.masterOverlayHidden) {
            checkbox.checked = state.masterOverlayHidden;
        }
    });
}

// --- Overlay Status (Alt1 mode) ---

/**
 * Show a compact overlay status indicator in the app window.
 * Replaces the HTML panels which are now rendered on the game overlay.
 */
function showOverlayStatus(): void {
    const panelsView = document.getElementById('panels-view');
    if (!panelsView) return;

    // Create status container in place of panels
    const overlayStatus = document.createElement('div');
    overlayStatus.id = 'overlay-status';
    overlayStatus.innerHTML = `
        <div class="overlay-status-header">
            <span class="overlay-status-dot"></span>
            <span class="overlay-status-label">Overlay Active</span>
        </div>
        <div class="overlay-status-info">
            Panels render on game screen.<br>
            Use Settings to adjust positions.
        </div>
        <button id="btn-preview-toggle" class="overlay-preview-btn">Preview in Window</button>
    `;
    // Insert BEFORE panelsView so the toggle button stays near the top of the
    // window even when previewing is on and the panels expand below it.
    // Otherwise the button gets pushed off the bottom of the visible area.
    panelsView.parentNode?.insertBefore(overlayStatus, panelsView);

    // Preview toggle: temporarily render panels as HTML for visual reference
    let previewing = false;
    let previewUnsubscribe: (() => void) | null = null;
    const previewBtn = document.getElementById('btn-preview-toggle');
    previewBtn?.addEventListener('click', () => {
        previewing = !previewing;
        if (panelsView) panelsView.style.display = previewing ? '' : 'none';
        if (previewBtn) previewBtn.textContent = previewing ? '\u2190 Hide Preview' : 'Preview in Window';

        if (previewing) {
            updatePanelVisibility();
            renderPanelsToHTML();
            // Subscribe to store updates while previewing. Capture the unsubscribe
            // handle so we can release it when preview is turned off — otherwise
            // every toggle adds a new subscriber that never goes away.
            previewUnsubscribe = store.subscribe(() => {
                renderPanelsToHTML();
            });
        } else if (previewUnsubscribe) {
            previewUnsubscribe();
            previewUnsubscribe = null;
        }
    });
}

// --- Detection ---

function initDetection(): void {
    // Try loading saved calibration, but verify position is still valid
    const saved = loadCalibration();
    // Surface a non-blocking banner if the saved calibration is more than 7 days old.
    // The user can dismiss it for the session, but it will reappear next launch
    // if the calibration is still stale.
    store.setCalibrationStale(isCalibrationStale(saved));
    if (saved) {
        const currentScale = getRsScaling();
        if (Math.abs(saved.rsScaling - currentScale) < 0.05) {
            // Sanity check: capture a small area at the saved position
            // and verify there's a green/red border there
            let buffValid = false;
            let debuffValid = false;

            if (saved.buffs && window.alt1 && alt1.permissionPixel) {
                try {
                    const testImg = a1lib.captureHold(
                        saved.buffs.x, saved.buffs.y,
                        Math.min(saved.buffs.gridSize * 2, 60),
                        Math.min(saved.buffs.gridSize, 30),
                    ).toData();
                    // Check if top-left pixel is green border
                    const r = testImg.data[0], g = testImg.data[1], b = testImg.data[2];
                    buffValid = g > 80 && (g - b) > 15;
                    log(`Calibration check buff (${saved.buffs.x},${saved.buffs.y}): px0=R${r}G${g}B${b} valid=${buffValid}`);
                } catch (e) {
                    log(`Calibration check failed: ${e}`, 'warn');
                }
            }

            if (saved.debuffs && window.alt1 && alt1.permissionPixel) {
                try {
                    const testImg = a1lib.captureHold(
                        saved.debuffs.x, saved.debuffs.y,
                        Math.min(saved.debuffs.gridSize * 2, 60),
                        Math.min(saved.debuffs.gridSize, 30),
                    ).toData();
                    const r = testImg.data[0], g = testImg.data[1], b = testImg.data[2];
                    debuffValid = r > 80 && (r - g) > 20;
                    log(`Calibration check debuff (${saved.debuffs.x},${saved.debuffs.y}): px0=R${r}G${g}B${b} valid=${debuffValid}`);
                } catch (e) {
                    log(`Calibration check debuff failed: ${e}`, 'warn');
                }
            }

            if (buffValid && saved.buffs) {
                buffReader = new BuffBarReader(saved.buffs);
                log(`Buffs bar verified at (${saved.buffs.x}, ${saved.buffs.y})`);
            }
            if (debuffValid && saved.debuffs) {
                debuffReader = new BuffBarReader(saved.debuffs);
                log(`Debuffs bar verified at (${saved.debuffs.x}, ${saved.debuffs.y})`);
            }

            // Enemy debuff region — validate with red border check (same as debuffs)
            if (saved.enemy && window.alt1 && alt1.permissionPixel) {
                try {
                    const testImg = a1lib.captureHold(
                        saved.enemy.x, saved.enemy.y,
                        Math.min(saved.enemy.gridSize * 2, 60),
                        Math.min(saved.enemy.gridSize, 30),
                    ).toData();
                    const r = testImg.data[0], g = testImg.data[1], b = testImg.data[2];
                    const enemyValid = r > 80 && (r - g) > 20;
                    log(`Calibration check enemy (${saved.enemy.x},${saved.enemy.y}): px0=R${r}G${g}B${b} valid=${enemyValid}`);
                    if (enemyValid) {
                        saved.enemy.isEnemy = true;
                        // Idempotent — skipped if the saved region was already padded
                        // when it was originally written. Required for users with
                        // calibration data from before this fix landed.
                        expandEnemyBarRegion(saved.enemy);
                        enemyReader = new BuffBarReader(saved.enemy);
                        log(`Enemy debuff bar verified at (${saved.enemy.x}, ${saved.enemy.y})`);
                    }
                } catch (e) {
                    log(`Calibration check enemy failed: ${e}`, 'warn');
                }
            }

            if (buffReader || debuffReader) {
                const parts: string[] = [];
                if (buffReader) parts.push('Buffs');
                if (debuffReader) parts.push('Debuffs');
                if (enemyReader) parts.push('Enemy');
                setStatus(`Reading: ${parts.join(' + ')}`, 'ok');
                startReading();
                return;
            } else {
                log('Saved calibration invalid (bar moved or no buffs active). Re-detect needed.', 'warn');
                clearCalibration();
            }
        } else {
            log(`Scale changed (${saved.rsScaling} -> ${currentScale}), re-detecting`, 'warn');
            clearCalibration();
        }
    }

    // No valid calibration — prompt user
    setStatus('Click Detect to set up buff bar tracking.', 'info');
}

/** Which detection step we're in */
let detectStep: 'idle' | 'scanning-buff' | 'waiting-buff-confirm' | 'scanning-debuff' | 'waiting-debuff-confirm' | 'scanning-enemy' | 'waiting-enemy-confirm' = 'idle';
let detectPollInterval: ReturnType<typeof setInterval> | null = null;
let frozenDetectResult: import('./lib/types').DetectionResult | null = null;

function runDetection(): void {
    stopReading();
    buffReader = null;
    debuffReader = null;
    enemyReader = null;
    store.clearAbilities();
    clearCalibration();

    // Start the hover-scan flow: buff → debuff → enemy target
    startHoverScan('buff');
}

function startHoverScan(mode: 'buff' | 'debuff' | 'enemy'): void {
    detectStep = mode === 'buff' ? 'scanning-buff' : mode === 'debuff' ? 'scanning-debuff' : 'scanning-enemy';
    frozenDetectResult = null;

    const labels: Record<string, { barType: string; borderColor: string; stepNum: string }> = {
        buff: { barType: 'BUFF', borderColor: 'green', stepNum: '1' },
        debuff: { barType: 'DEBUFF', borderColor: 'red', stepNum: '2' },
        enemy: { barType: 'ENEMY DEBUFF', borderColor: 'red', stepNum: '3' },
    };
    const { barType, borderColor } = labels[mode];
    setStatus(`Hover your mouse over any ${barType} icon (${borderColor} border)...`, 'warn');
    log(`Detection: scanning for ${barType} icon under mouse...`);

    showDetectPrompt();

    // Track scan start so we can show a UI scale hint if nothing is found after a while
    const scanStartTime = Date.now();
    let scaleHintShown = false;

    // Start polling mouse position + checking for buff icon
    if (detectPollInterval) clearInterval(detectPollInterval);
    detectPollInterval = setInterval(() => {
        if (detectStep !== 'scanning-buff' && detectStep !== 'scanning-debuff' && detectStep !== 'scanning-enemy') {
            if (detectPollInterval) { clearInterval(detectPollInterval); detectPollInterval = null; }
            return;
        }

        // Enemy debuffs use red borders (same as player debuffs)
        const scanAsDebuff = detectStep === 'scanning-debuff' || detectStep === 'scanning-enemy';
        const result = detectBarFromClick(scanAsDebuff);

        if (result.success && result.region) {
            frozenDetectResult = result;
            if (detectPollInterval) { clearInterval(detectPollInterval); detectPollInterval = null; }

            if (detectStep === 'scanning-buff') detectStep = 'waiting-buff-confirm';
            else if (detectStep === 'scanning-debuff') detectStep = 'waiting-debuff-confirm';
            else detectStep = 'waiting-enemy-confirm';

            setStatus(`Found ${barType.toLowerCase()} bar! ${result.message}`, 'ok');
            log(`Auto-detected: ${result.message}`);

            showDetectPrompt();
            return;
        }

        // After 8 seconds with no detection, surface a UI scale hint.
        // Most "won't detect" issues are caused by the RS3 in-game interface
        // scale being outside the range the detector handles.
        if (!scaleHintShown && Date.now() - scanStartTime > 8000) {
            scaleHintShown = true;
            setStatus(
                `Couldn't find a ${barType.toLowerCase()} icon yet. If hovering doesn't work, try changing your RS3 in-game UI Settings → Display → Interface Scale, then click Detect again.`,
                'warn',
            );
        }
    }, 150);
}

function showDetectPrompt(): void {
    const controls = document.getElementById('controls');
    if (!controls) return;

    // Remove any existing prompt
    document.getElementById('detect-prompt')?.remove();

    const prompt = document.createElement('div');
    prompt.id = 'detect-prompt';

    const isScanning = detectStep === 'scanning-buff' || detectStep === 'scanning-debuff' || detectStep === 'scanning-enemy';
    const isDebuffStep = detectStep === 'scanning-debuff' || detectStep === 'waiting-debuff-confirm';
    const isEnemyStep = detectStep === 'scanning-enemy' || detectStep === 'waiting-enemy-confirm';
    const isFrozen = detectStep === 'waiting-buff-confirm' || detectStep === 'waiting-debuff-confirm' || detectStep === 'waiting-enemy-confirm';

    if (isScanning) {
        // Scanning state — show instructions + cancel
        const barType = isEnemyStep ? 'ENEMY DEBUFF' : isDebuffStep ? 'DEBUFF' : 'BUFF';
        const borderColor = (isDebuffStep || isEnemyStep) ? 'red' : 'green';
        const stepNum = isEnemyStep ? '3' : isDebuffStep ? '2' : '1';
        prompt.style.cssText = 'margin-top:6px; padding:8px; background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.25); border-radius:5px;';

        const label = document.createElement('div');
        label.style.cssText = 'font-size:11px; color:#fcd34d; margin-bottom:4px; font-weight:500;';
        label.textContent = `Step ${stepNum}: Hover your mouse over any ${barType} icon (${borderColor} border)`;
        prompt.appendChild(label);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:10px; color:rgba(255,255,255,0.3); margin-bottom:6px;';
        hint.textContent = 'Scanning... move your mouse slowly over the buff bar.';
        prompt.appendChild(hint);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:4px;';

        if (isDebuffStep || isEnemyStep) {
            const skipBtn = document.createElement('button');
            skipBtn.textContent = isEnemyStep ? 'Skip Enemy Debuffs' : 'Skip Debuffs';
            skipBtn.style.cssText = 'flex:1; padding:5px 8px; font-size:11px; border:1px solid rgba(255,255,255,0.1); border-radius:4px; background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.5); cursor:pointer;';
            skipBtn.addEventListener('click', isEnemyStep ? onDetectSkipEnemy : onDetectSkipDebuffs);
            btnRow.appendChild(skipBtn);
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:5px 8px; font-size:11px; border:1px solid rgba(239,68,68,0.3); border-radius:4px; background:rgba(239,68,68,0.08); color:#fca5a5; cursor:pointer;';
        cancelBtn.addEventListener('click', onDetectCancel);
        btnRow.appendChild(cancelBtn);

        prompt.appendChild(btnRow);

    } else if (isFrozen) {
        // Found state — show result + confirm/retry
        const barType = isEnemyStep ? 'enemy debuff' : isDebuffStep ? 'debuff' : 'buff';
        prompt.style.cssText = 'margin-top:6px; padding:8px; background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.25); border-radius:5px;';

        const label = document.createElement('div');
        label.style.cssText = 'font-size:11px; color:#86efac; margin-bottom:6px; font-weight:500;';
        label.textContent = `Found ${barType} bar! Confirm to use this location.`;
        prompt.appendChild(label);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:4px;';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Confirm';
        confirmBtn.style.cssText = 'flex:1; padding:5px 8px; font-size:11px; font-weight:500; border:1px solid rgba(34,197,94,0.4); border-radius:4px; background:rgba(34,197,94,0.15); color:#86efac; cursor:pointer;';
        confirmBtn.addEventListener('click', onDetectConfirm);
        btnRow.appendChild(confirmBtn);

        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry';
        retryBtn.style.cssText = 'padding:5px 8px; font-size:11px; border:1px solid rgba(251,191,36,0.3); border-radius:4px; background:rgba(251,191,36,0.08); color:#fcd34d; cursor:pointer;';
        retryBtn.addEventListener('click', () => startHoverScan(isEnemyStep ? 'enemy' : isDebuffStep ? 'debuff' : 'buff'));
        btnRow.appendChild(retryBtn);

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:5px 8px; font-size:11px; border:1px solid rgba(239,68,68,0.3); border-radius:4px; background:rgba(239,68,68,0.08); color:#fca5a5; cursor:pointer;';
        cancelBtn.addEventListener('click', onDetectCancel);
        btnRow.appendChild(cancelBtn);

        prompt.appendChild(btnRow);
    }

    controls.parentNode?.insertBefore(prompt, controls.nextSibling);
}

function removeDetectPrompt(): void {
    document.getElementById('detect-prompt')?.remove();
    if (detectPollInterval) { clearInterval(detectPollInterval); detectPollInterval = null; }
    detectStep = 'idle';
    frozenDetectResult = null;
}

function onDetectConfirm(): void {
    if (!frozenDetectResult?.success || !frozenDetectResult.region) {
        log('No frozen detection result to confirm', 'warn');
        return;
    }

    const step = detectStep;
    if (step === 'waiting-buff-confirm') {
        handleDetectionResult(frozenDetectResult, 'buff');
        frozenDetectResult = null;
        applyPartialCalibration();
        startHoverScan('debuff');
    } else if (step === 'waiting-debuff-confirm') {
        handleDetectionResult(frozenDetectResult, 'debuff');
        frozenDetectResult = null;
        applyPartialCalibration();
        startHoverScan('enemy');
    } else if (step === 'waiting-enemy-confirm') {
        handleDetectionResult(frozenDetectResult, 'enemy');
        frozenDetectResult = null;
        finishDetection();
    }
}

/**
 * Save the current calibration state and start the read loop, even if not all
 * three bars have been detected yet. Called after each detect step's confirm
 * so users who only want buff bar tracking can stop after step 1 and have
 * the gauge work immediately. Idempotent — safe to call multiple times.
 */
function applyPartialCalibration(): void {
    if (!buffReader && !debuffReader && !enemyReader) return;
    saveCalibration(createCalibration(
        buffReader?.region ?? null,
        debuffReader?.region ?? null,
        getRsScaling(),
        enemyReader?.region ?? null,
    ));
    const parts: string[] = [];
    if (buffReader) parts.push('Buffs');
    if (debuffReader) parts.push('Debuffs');
    if (enemyReader) parts.push('Enemy');
    setStatus(`Reading: ${parts.join(' + ')}`, 'ok');
    startReading(); // idempotent — has isRunning guard
}

function onDetectSkipDebuffs(): void {
    if (detectPollInterval) { clearInterval(detectPollInterval); detectPollInterval = null; }
    log('Skipping debuff detection — proceeding to enemy debuffs');
    startHoverScan('enemy');
}

function onDetectSkipEnemy(): void {
    if (detectPollInterval) { clearInterval(detectPollInterval); detectPollInterval = null; }
    log('Skipping enemy debuff detection');
    finishDetection();
}

function onDetectCancel(): void {
    removeDetectPrompt();
    setStatus('Detection cancelled.', 'info');
    log('Detection cancelled by user');
}

function finishDetection(): void {
    removeDetectPrompt();

    const foundAny = buffReader || debuffReader || enemyReader;
    if (foundAny) {
        saveCalibration(createCalibration(
            buffReader?.region ?? null,
            debuffReader?.region ?? null,
            getRsScaling(),
            enemyReader?.region ?? null,
        ));

        const parts: string[] = [];
        if (buffReader) parts.push('Buffs');
        if (debuffReader) parts.push('Debuffs');
        if (enemyReader) parts.push('Enemy');
        setStatus(`Reading: ${parts.join(' + ')}`, 'ok');
        startReading();
    } else {
        setStatus('No bars detected. Click Detect to try again.', 'warn');
    }
}

function handleDetectionResult(result: DetectionResult, mode: 'buff' | 'debuff' | 'enemy'): void {
    if (result.success && result.region) {
        if (mode === 'enemy') {
            result.region.isEnemy = true;
            // Symmetric scan-area expansion around the anchor — see expandEnemyBarRegion
            // for the rationale. Must run BEFORE the BuffBarReader is constructed so
            // the reader sees the padded region from its first read cycle.
            expandEnemyBarRegion(result.region);
        }
        const reader = new BuffBarReader(result.region);
        if (mode === 'enemy') {
            enemyReader = reader;
        } else if (mode === 'debuff') {
            debuffReader = reader;
        } else {
            buffReader = reader;
        }
        log(result.message);
    } else {
        log(result.message, 'warn');
        if (mode === 'enemy') {
            enemyReader = null;
        } else if (mode === 'debuff') {
            debuffReader = null;
        } else {
            buffReader = null;
        }
    }
}

// --- Reading Loop ---

function startReading(): void {
    if (isRunning) return;
    isRunning = true;
    store.setReadingState(true);

    readInterval = setInterval(() => {
        try {
            readAndUpdate();
        } catch (e) {
            log(`Read error: ${e}`, 'error');
        }
    }, POLL_INTERVAL_MS);

    log('Started reading loop');
}

function stopReading(): void {
    if (readInterval) {
        clearInterval(readInterval);
        readInterval = null;
    }
    isRunning = false;
    store.setReadingState(false);
    log('Stopped reading loop');
}

/**
 * Single read cycle: capture buff/debuff bars and update the store.
 * The gauge UI re-renders automatically via store subscription.
 */
let readCount = 0;
function readAndUpdate(): void {
    const currentStyle = store.getState().combatStyle;
    const styleDef = getStyleDef(currentStyle);
    if (!styleDef) return;

    // Log ref image status and bar position on first few reads
    if (readCount < 3 && debugMode && verboseDebug) {
        const refs = getRefImages();
        const refKeys = Object.keys(refs);
        log(`READ #${readCount} | Refs: ${refKeys.length} | Style: ${currentStyle}`, 'debug');
        if (buffReader) {
            const r = buffReader.region;
            const rect = buffReader.getCaptureRect();
            log(`  Buff bar: origin=(${r.x},${r.y}) grid=${r.gridSize} icon=${r.iconSize} maxCol=${r.maxColumns} maxRow=${r.maxRows}`, 'debug');
            log(`  Capture rect: (${rect.x},${rect.y}) ${rect.width}x${rect.height}`, 'debug');
        }
        if (debuffReader) {
            const r = debuffReader.region;
            log(`  Debuff bar: origin=(${r.x},${r.y}) grid=${r.gridSize} icon=${r.iconSize} maxCol=${r.maxColumns}`, 'debug');
        }
        // Dump first ref pixel values
        if (readCount === 0 && refKeys.length > 0) {
            const sample = refs[refKeys[0]];
            if (sample) {
                const d = sample.data;
                log(`  Ref[${refKeys[0]}] px(0,0)=R${d[0]}G${d[1]}B${d[2]}A${d[3]}`, 'debug');
            }
        }
    }
    readCount++;

    // Collect all slots for session recording
    let allBuffSlots: BuffSlot[] = [];
    let allDebuffSlots: BuffSlot[] = [];
    let allEnemySlots: BuffSlot[] = [];

    // Read buffs
    if (buffReader) {
        // Capture the buffer for dual-text timer reads
        const rect = buffReader.getCaptureRect();
        if (window.alt1 && alt1.permissionPixel) {
            lastBuffBuffer = a1lib.capture(rect.x, rect.y, rect.width, rect.height);
        }
        const buffs = buffReader.read(lastBuffBuffer ?? undefined);
        allBuffSlots = buffs;
        if (buffs.length > 0 && debugMode && verboseDebug) {
            log(`Read ${buffs.length} buff slots (style: ${currentStyle})`, 'debug');
            for (const slot of buffs.slice(0, 5)) {
                log(`  Slot col=${slot.column} time=${slot.time} argText="${slot.argText}" iconData=${slot.iconData ? `${slot.iconData.width}x${slot.iconData.height}` : 'null'}`, 'debug');
            }
        }
        // Layer 1: Skip processing during bar reflow (sudden slot count drop)
        if (buffs.length < prevBuffSlotCount - 2 && prevBuffSlotCount > 3) {
            if (debugMode) log(`[Reflow] Slot drop ${prevBuffSlotCount}\u2192${buffs.length}, holding state`, 'debug');
            prevBuffSlotCount = buffs.length;
            // Don't process — keep previous ability states
        } else {
            prevBuffSlotCount = buffs.length;
            processSlots(buffs, styleDef.abilities.filter(a => a.source === 'buff'));
        }

        if (debugMode && verboseDebug) {
            log(`Read ${buffs.length} buff slots`, 'debug');
        }
    }

    // Read debuffs
    if (debuffReader) {
        const debuffs = debuffReader.read();
        allDebuffSlots = debuffs;
        processSlots(debuffs, styleDef.abilities.filter(a => a.source === 'debuff'));

        if (debugMode && verboseDebug) {
            log(`Read ${debuffs.length} debuff slots`, 'debug');
        }
    }

    // Read enemy target debuffs
    if (enemyReader) {
        const enemySlots = enemyReader.read();
        allEnemySlots = enemySlots;
        processEnemyDebuffs(enemySlots, styleDef.abilities.filter(a => a.source === 'enemy'));

        if (debugMode && verboseDebug && enemySlots.length > 0) {
            log(`Read ${enemySlots.length} enemy debuff slots`, 'debug');
        }
    }

    // --- Cycle summary and change-only logging (deduped) ---
    if (debugMode) {
        const now = Date.now();
        if (cycleMatches.length > 0) {
            const abilities = cycleMatches.map(m => `${m.shortName}:${(m.score*100).toFixed(0)}%@c${m.col}:${m.time}s`).join(' ');
            const summary = `matched=${cycleMatches.length} | ${abilities}`;

            if (summary !== prevCycleSummary) {
                log(`[Cycle] ${summary}`, 'debug');
                prevCycleSummary = summary;
                lastCycleLogTime = now;
            } else if (now - lastCycleLogTime >= HEARTBEAT_INTERVAL_MS) {
                log(`[Heartbeat] stable ${Math.round((now - lastCycleLogTime) / 1000)}s | ${summary}`, 'debug');
                lastCycleLogTime = now;
            }
        } else if (prevCycleSummary !== '' && cycleMatches.length === 0) {
            prevCycleSummary = '';
            lastCycleLogTime = now;
        } else if (cycleMatches.length === 0 && now - lastCycleLogTime >= HEARTBEAT_INTERVAL_MS) {
            log(`[Heartbeat] idle ${Math.round((now - lastCycleLogTime) / 1000)}s | matched=0`, 'debug');
            lastCycleLogTime = now;
        }
    }

    // Change-only detail logging (compare against previous cycle)
    if (debugMode) {
        const currentIds = new Set(cycleMatches.map(m => m.id));

        // New appearances
        for (const m of cycleMatches) {
            if (!prevCycleState[m.id]) {
                log(`[NEW] ${m.shortName} appeared score=${(m.score*100).toFixed(0)}% col=${m.col}`, 'info');
            }
        }

        // Disappearances
        for (const [id, prev] of Object.entries(prevCycleState)) {
            if (!currentIds.has(id)) {
                log(`[GONE] ${prev.shortName || id} disappeared from col=${prev.slot}`, 'info');
            }
        }

        // Column shifts
        for (const m of cycleMatches) {
            if (prevCycleState[m.id] && prevCycleState[m.id].slot !== m.col) {
                log(`[SHIFT] ${m.shortName} moved col ${prevCycleState[m.id].slot}\u2192${m.col}`, 'debug');
            }
        }

        // Score drops below 70%
        for (const m of cycleMatches) {
            if (prevCycleState[m.id] && prevCycleState[m.id].score >= 0.70 && m.score < 0.70) {
                log(`[WARN] ${m.shortName} score dropped ${(prevCycleState[m.id].score*100).toFixed(0)}%\u2192${(m.score*100).toFixed(0)}%`, 'warn');
            }
        }

        // Update prevCycleState
        for (const key of Object.keys(prevCycleState)) delete prevCycleState[key];
        for (const m of cycleMatches) {
            prevCycleState[m.id] = { shortName: m.shortName, score: m.score, time: m.time, slot: m.col, stacks: m.stacks };
        }
    }

    // Clear cycle matches for next cycle
    cycleMatches = [];

    // Session recording: capture all slot data per frame
    if (sessionRecording) {
        const allSlots = [...allBuffSlots, ...allDebuffSlots, ...allEnemySlots];
        sessionFrames.push({
            timestamp: Date.now(),
            slots: allSlots.map(s => ({
                column: s.column,
                row: s.row,
                isDebuff: s.isDebuff,
                time: s.time,
                altTime: s.altTime,
                argText: s.argText,
                pixels: Array.from(s.iconData.data),
            })),
        });
        // Auto-stop at 1000 frames to prevent memory issues
        if (sessionFrames.length >= 1000) {
            stopAndExportSession();
            log('Session recording auto-stopped at 1000 frames', 'warn');
        }
    }
}

/** Minimum ratio of passed pixels to consider a match */
const MATCH_THRESHOLD = 0.55;

/** Abilities excluded from [Cycle] log to reduce noise (tracked internally but not displayed) */
const CYCLE_LOG_EXCLUDED = new Set(['bone_shield', 'death_spark', 'death_essence_buff', 'death_essence_debuff', 'death_spark_inactive']);

/** Ability debounce: require N consecutive match cycles before activating */
const ABILITY_DEBOUNCE_CYCLES = 5;  // 5 × 200ms = 1.0s
const abilityMatchCounts: Record<string, number> = {};

/** Layer 1: Previous buff slot count for reflow detection */
let prevBuffSlotCount = 0;

/** Layer 2: Miss counter grace — replaces time-based grace period */
const abilityMissCount: Record<string, number> = {};
const ABILITY_GRACE_MISSES = 10; // 10 × 200ms = 2 seconds of consecutive misses before deactivation

/** Verbose debug: gates per-slot per-attempt logging. Set via console: (window as any).verboseDebug = true */
let verboseDebug = false;

/** Cycle-level state tracking for change-only logging */
const prevCycleState: Record<string, { shortName: string; score: number; time: number; slot: number; stacks?: number }> = {};
let cycleMatches: Array<{ id: string; shortName: string; score: number; col: number; time: number; stacks?: number; type: string }> = [];
let prevCycleSummary = '';
let lastCycleLogTime = 0;
const HEARTBEAT_INTERVAL_MS = 10000;


/**
 * Match detected buff slots against known ability definitions using
 * reference image comparison, then update the store.
 *
 * Shared dual-text timer read for any ability with maskProfile === 'dual-text'.
 * Lower-left (slot.time) is ALWAYS stacks for dual-text icons.
 * Timer is read from upper-left using the same 'up' scan approach as lower-left:
 * place origin BELOW the text zone and scan upward into it.
 * Upper-left text sits at rows 1-9; origin at row 10, scan up captures rows 2-12.
 */
function readDualTextTimer(slot: BuffSlot): { time: number; scanX: number; scanY: number; bufW: number; bufH: number; rawStrict: string; rawRelaxed: string } {
    if (!lastBuffBuffer || !buffReader) return { time: 0, scanX: 0, scanY: 0, bufW: 0, bufH: 0, rawStrict: '', rawRelaxed: '' };
    const gridSize = buffReader.region.gridSize;
    // Same X offset as Timer 1 (lower-left).
    const textOffsetX = Math.round(2 * (gridSize / 30));
    // Place origin below upper-left text (row 10 at 100% scale) and scan UP
    const upperTextOffsetY = Math.round(10 * (gridSize / 30));
    const scanX = slot.bufferX + textOffsetX;
    const scanY = slot.bufferY + upperTextOffsetY;
    const upperRead = readUpperTimerFromPixels(
        lastBuffBuffer,
        scanX,
        scanY,
        'up',
        gridSize
    );

    return { time: upperRead.time, scanX, scanY, bufW: lastBuffBuffer.width, bufH: lastBuffBuffer.height, rawStrict: upperRead.rawStrict, rawRelaxed: upperRead.rawRelaxed };
}

/**
 * Two sub-passes by mask profile:
 * Sub-pass A — default-mask abilities (maskProfile undefined or 'default')
 * Sub-pass B — dual-text abilities against remaining unmatched slots only
 */
function processSlots(
    slots: BuffSlot[],
    abilityDefs: import('./data/abilities').AbilityDef[],
): Set<BuffSlot> {
    const refImages = getRefImages();
    const now = Date.now();
    const matchedIds = new Set<string>();
    const consumedSlots = new Set<BuffSlot>();
    const assignedSlots = new Map<BuffSlot, { def: import('./data/abilities').AbilityDef; score: number }>();

    // Helper: find best matching ability for a slot from a filtered set of defs
    const findBestMatch = (
        slot: BuffSlot,
        defs: import('./data/abilities').AbilityDef[],
        mask: 'default' | 'dual-text' = 'default',
    ): { def: import('./data/abilities').AbilityDef | null; score: number } => {
        let bestScore = 0;
        let bestDef: import('./data/abilities').AbilityDef | null = null;
        for (const def of defs) {
            if (!def.refImage || matchedIds.has(def.id)) continue;
            const ref = refImages[def.refImage];
            if (ref) {
                const result = compareBuffIcons(slot.iconData, ref, 80, mask);
                if (result.tested > 0) {
                    const score = result.passed / result.tested;
                    if (score > bestScore) { bestScore = score; bestDef = def; }
                }
            }
            if (def.altRefImage) {
                const altRef = refImages[def.altRefImage];
                if (altRef) {
                    const result = compareBuffIcons(slot.iconData, altRef, 80, mask);
                    if (result.tested > 0) {
                        const score = result.passed / result.tested;
                        if (score > bestScore) { bestScore = score; bestDef = def; }
                    }
                }
            }
        }
        return { def: bestDef, score: bestScore };
    };

    // Sub-pass A: default-mask abilities
    const defaultDefs = abilityDefs.filter(d => !d.maskProfile || d.maskProfile === 'default');
    for (const slot of slots) {
        const { def: bestDef, score: bestScore } = findBestMatch(slot, defaultDefs, 'default');

        if (bestDef && bestScore >= MATCH_THRESHOLD) {
            assignedSlots.set(slot, { def: bestDef, score: bestScore });
            matchedIds.add(bestDef.id);
            consumedSlots.add(slot);
            if (!CYCLE_LOG_EXCLUDED.has(bestDef.id)) {
                cycleMatches.push({ id: bestDef.id, shortName: bestDef.shortName, score: bestScore, col: slot.column, time: slot.time, type: 'ability' });
            }
            if (verboseDebug) log(`[Match] ${bestDef.name} score=${(bestScore*100).toFixed(0)}% slot=col${slot.column} time=${slot.time}s`, 'debug');
        }
    }

    // Sub-pass B: dual-text abilities against remaining unmatched slots
    const dualTextDefs = abilityDefs.filter(d => d.maskProfile === 'dual-text');
    if (dualTextDefs.length > 0) {
        for (const slot of slots) {
            if (assignedSlots.has(slot)) continue;
            const { def: bestDef, score: bestScore } = findBestMatch(slot, dualTextDefs, 'dual-text');

            if (bestDef && bestScore >= MATCH_THRESHOLD) {
                assignedSlots.set(slot, { def: bestDef, score: bestScore });
                matchedIds.add(bestDef.id);
                consumedSlots.add(slot);
                if (!CYCLE_LOG_EXCLUDED.has(bestDef.id)) {
                    cycleMatches.push({ id: bestDef.id, shortName: bestDef.shortName, score: bestScore, col: slot.column, time: slot.time, type: 'ability' });
                }
                if (verboseDebug) log(`[Match/dual-text] ${bestDef.name} score=${(bestScore*100).toFixed(0)}% slot=col${slot.column} time=${slot.time}s`, 'debug');
            }
        }
    }

    // Process all assigned slots through debounce + store update logic
    for (const [slot, { def: bestDef, score: bestScore }] of assignedSlots) {
        // Bone Shield: consume slot silently — never activate, never render
        if (bestDef.id === 'bone_shield') continue;

        // Debounce: require consecutive match cycles before activating
        abilityMatchCounts[bestDef.id] = (abilityMatchCounts[bestDef.id] || 0) + 1;

        // Layer 2: Reset miss counter on match
        abilityMissCount[bestDef.id] = 0;

        // Layer 3: Bypass debounce for recently-active abilities (prevents re-activation flicker)
        const currentAbilityState = store.getState().abilities[bestDef.id];
        const wasRecentlyActive = currentAbilityState?.active ||
            (currentAbilityState?.lastSeen && (now - currentAbilityState.lastSeen) < 2000);

        if (!wasRecentlyActive && abilityMatchCounts[bestDef.id] < ABILITY_DEBOUNCE_CYCLES) continue;

        // Dual-text abilities: timer ONLY from upper-left (Timer 2), stacks always 0.
        // Raw reader output passes directly to gauge — no smoothing, no fallback.
        if (bestDef.maskProfile === 'dual-text') {
            const dual = readDualTextTimer(slot);
            if (verboseDebug) {
                log(`[DualText] ${bestDef.shortName} buf=${dual.bufW}x${dual.bufH} scanAt=(${dual.scanX},${dual.scanY}) timer=${dual.time}s raw180="${dual.rawStrict}" raw150="${dual.rawRelaxed}" col=${slot.column}`, 'debug');
            }
            store.updateAbility(bestDef.id, {
                active: true,
                time: dual.time,
                stacks: 0,
                lastSeen: now,
            });
        } else if (bestDef.type === 'stacking-buff') {
            const stacks = parseInt(slot.argText) || slot.time || 0;
            if (bestDef.maxStacks && stacks > bestDef.maxStacks) {
                if (debugMode && verboseDebug) {
                    log(`  Rejected ${bestDef.name}: stacks=${stacks} > maxStacks=${bestDef.maxStacks}`, 'debug');
                }
                continue;
            }
            store.updateAbility(bestDef.id, {
                active: true,
                time: 0,
                stacks,
                lastSeen: now,
            });
        } else {
            // Cooldown inference: record castTimestamp on first detection
            const currentState = store.getState().abilities[bestDef.id];
            const wasActive = currentState?.active || false;
            const castTimestamp = (bestDef.type === 'ability' && bestDef.cooldownStart === 'on-cast' && !wasActive)
                ? now : (currentState?.castTimestamp || 0);

            let cooldownRemaining = 0;
            if (bestDef.type === 'ability' && bestDef.cooldownStart === 'on-cast' && bestDef.cooldownDuration && castTimestamp > 0) {
                const elapsed = (now - castTimestamp) / 1000;
                cooldownRemaining = Math.max(0, bestDef.cooldownDuration - elapsed);
            }

            store.updateAbility(bestDef.id, {
                active: true,
                time: slot.time,
                stacks: 0,
                lastSeen: now,
                castTimestamp,
                cooldownRemaining,
                isOnCooldown: false,
            });
        }
    }

    // Gradually decay debounce counters for abilities that weren't matched this cycle
    for (const def of abilityDefs) {
        if (!matchedIds.has(def.id)) {
            if (abilityMatchCounts[def.id] > 0) {
                abilityMatchCounts[def.id] = Math.max(0, abilityMatchCounts[def.id] - 1);
            }
        }
    }

    // Mark unmatched abilities as inactive (with flicker protection + cooldown inference)
    for (const def of abilityDefs) {
        if (matchedIds.has(def.id)) continue;
        const currentState = store.getState().abilities[def.id];
        if (!currentState) continue;

        if (currentState.active) {
            // Layer 2: Miss counter grace — increment miss count each cycle ability is not seen
            abilityMissCount[def.id] = (abilityMissCount[def.id] || 0) + 1;
            const graceMisses = def.type === 'stacking-buff' ? 5 : ABILITY_GRACE_MISSES; // 5 × 200ms = 1s for stacking — fast deactivation when player spends all stacks
            if (abilityMissCount[def.id] > graceMisses) {
                // Ability disappeared — exceeded miss threshold. Start cooldown if applicable
                if (def.type === 'ability' && def.cooldownDuration) {
                    if (def.cooldownStart === 'on-expiry') {
                        // CD starts now
                        store.updateAbility(def.id, {
                            active: false, time: 0, stacks: 0,
                            isOnCooldown: true,
                            cooldownRemaining: def.cooldownDuration,
                            castTimestamp: 0,
                        });
                    } else if (def.cooldownStart === 'on-cast' && currentState.castTimestamp > 0) {
                        // CD was running since cast — compute remaining
                        const elapsed = (now - currentState.castTimestamp) / 1000;
                        const remaining = Math.max(0, def.cooldownDuration - elapsed);
                        store.updateAbility(def.id, {
                            active: false, time: 0, stacks: 0,
                            isOnCooldown: remaining > 0,
                            cooldownRemaining: remaining,
                            castTimestamp: currentState.castTimestamp,
                        });
                    } else {
                        store.updateAbility(def.id, { active: false, time: 0, stacks: 0 });
                    }
                } else {
                    store.updateAbility(def.id, { active: false, time: 0, stacks: 0 });
                }
            }
            // Within grace: keep current state
        } else if (currentState.isOnCooldown && currentState.cooldownRemaining > 0) {
            // Ability is on cooldown — decrement remaining
            // Read cycle is POLL_INTERVAL_MS
            const newRemaining = Math.max(0, currentState.cooldownRemaining - (POLL_INTERVAL_MS / 1000));
            store.updateAbility(def.id, {
                cooldownRemaining: newRemaining,
                isOnCooldown: newRemaining > 0,
            });
        }
    }

    return consumedSlots;
}


/**
 * Process enemy target debuff slots.
 * Matches against enemy-debuff abilities (Invoke Death, Bloat).
 * Bloat uses an internal hardcoded timer (internalDuration) that starts
 * counting down when the debuff is first detected on the enemy.
 */
function processEnemyDebuffs(
    slots: BuffSlot[],
    enemyDefs: import('./data/abilities').AbilityDef[],
): void {
    const refImages = getRefImages();
    const now = Date.now();
    const matchedIds = new Set<string>();

    for (const slot of slots) {
        let bestScore = 0;
        let bestDef: import('./data/abilities').AbilityDef | null = null;

        for (const def of enemyDefs) {
            if (!def.refImage || matchedIds.has(def.id)) continue;
            const ref = refImages[def.refImage];
            if (!ref) continue;

            const result = compareBuffIcons(slot.iconData, ref);
            if (result.tested === 0) continue;

            const score = result.passed / result.tested;
            if (score > bestScore) {
                bestScore = score;
                bestDef = def;
            }
        }

        if (bestDef && bestScore >= MATCH_THRESHOLD) {
            matchedIds.add(bestDef.id);
            cycleMatches.push({ id: bestDef.id, shortName: bestDef.shortName, score: bestScore, col: slot.column, time: slot.time, type: 'ability' });

            if (bestDef.internalDuration && bestDef.internalDuration > 0) {
                // Internal timer ability (e.g., Bloat 20.5s)
                // Start timer on first detection, keep running until debuff disappears
                if (bestDef.id === 'bloat' && !bloatTimer.active) {
                    bloatTimer.active = true;
                    bloatTimer.remaining = bestDef.internalDuration;
                    if (bloatTimer.interval) clearInterval(bloatTimer.interval);
                    bloatTimer.interval = setInterval(() => {
                        bloatTimer.remaining = Math.max(0, bloatTimer.remaining - (POLL_INTERVAL_MS / 1000));
                        store.updateAbility('bloat', {
                            active: true,
                            time: Math.round(bloatTimer.remaining),
                            lastSeen: Date.now(),
                        });
                        if (bloatTimer.remaining <= 0) {
                            if (bloatTimer.interval) clearInterval(bloatTimer.interval);
                            bloatTimer.interval = null;
                        }
                    }, POLL_INTERVAL_MS);
                }
                store.updateAbility(bestDef.id, {
                    active: true,
                    time: Math.round(bloatTimer.remaining || bestDef.internalDuration),
                    lastSeen: now,
                });
            } else {
                // Presence-only detection (e.g., Invoke Death)
                store.updateAbility(bestDef.id, {
                    active: true,
                    time: slot.time,
                    lastSeen: now,
                });
            }
        }
    }

    // Mark unmatched enemy debuffs as inactive
    for (const def of enemyDefs) {
        if (matchedIds.has(def.id)) continue;
        const currentState = store.getState().abilities[def.id];
        if (currentState?.active) {
            const age = now - (currentState.lastSeen || 0);
            if (age > 2000) {
                store.updateAbility(def.id, { active: false, time: 0 });
                // Clean up Bloat internal timer
                if (def.id === 'bloat' && bloatTimer.active) {
                    bloatTimer.active = false;
                    bloatTimer.remaining = 0;
                    if (bloatTimer.interval) { clearInterval(bloatTimer.interval); bloatTimer.interval = null; }
                }
            }
        }
    }
}

// --- UI Event Handlers ---

function onDetectClick(): void {
    runDetection();
}

function onCalibrateClick(): void {
    clearCalibration();
    buffReader = null;
    debuffReader = null;
    enemyReader = null;
    if (bloatTimer.interval) { clearInterval(bloatTimer.interval); bloatTimer.interval = null; }
    bloatTimer.active = false;
    bloatTimer.remaining = 0;
    stopReading();
    store.clearAbilities();
    setStatus('Reset. Click Detect to re-scan.', 'info');
}

function openSettings(): void {
    settingsOpen = true;
    const panelsView = document.getElementById('panels-view');
    const overlayStatus = document.getElementById('overlay-status');
    const settingsView = document.getElementById('settings-view');
    const settingsBtn = document.getElementById('btn-settings');
    const settingsContent = document.getElementById('settings-content');

    if (panelsView) panelsView.style.display = 'none';
    if (overlayStatus) overlayStatus.style.display = 'none';
    if (settingsView) settingsView.style.display = '';
    if (settingsContent) renderSettings(settingsContent);
    settingsBtn?.classList.add('active');
    log('Settings panel: OPEN');
}

function closeSettings(): void {
    settingsOpen = false;
    const panelsView = document.getElementById('panels-view');
    const overlayStatus = document.getElementById('overlay-status');
    const settingsView = document.getElementById('settings-view');
    const settingsBtn = document.getElementById('btn-settings');

    if (settingsView) settingsView.style.display = 'none';
    if (overlayStatus) overlayStatus.style.display = '';
    // Only show panels view in demo mode (browser without Alt1)
    if (panelsView && isDemoMode) panelsView.style.display = '';
    settingsBtn?.classList.remove('active');
    log('Settings panel: CLOSED');
}

function onSettingsClick(): void {
    if (settingsOpen) {
        closeSettings();
    } else {
        openSettings();
    }
}

function updatePanelVisibility(): void {
    const state = store.getState();

    const gaugeEl = document.getElementById('panel-combat-gauge');
    const buffsEl = document.getElementById('panel-combat-buffs');

    // Master kill switch overrides per-panel visibility. Per-panel state is
    // preserved so flipping master back to false restores the prior layout.
    const hideAll = state.masterOverlayHidden;
    if (gaugeEl) gaugeEl.style.display = (!hideAll && state.panels['combat-gauge'].visible) ? '' : 'none';
    if (buffsEl) buffsEl.style.display = (!hideAll && state.panels['combat-buffs'].visible) ? '' : 'none';

    // If settings panel is open, refresh it to reflect any state changes
    if (settingsOpen) {
        const settingsContent = document.getElementById('settings-content');
        if (settingsContent) {
            renderSettings(settingsContent);
        }
    }
}

// --- Render panels to HTML ---

function renderPanelsToHTML(): void {
    const state = store.getState();
    const styleDef = getStyleDef(state.combatStyle);

    // Hot-swap gauge renderer if style changed
    if (state.overlayStyle !== currentRendererStyle) {
        currentRendererStyle = state.overlayStyle;
        gaugeRenderer = createGaugeRenderer(state.overlayStyle);
    }

    // Master kill switch — when hidden, skip rendering both panels entirely.
    const hideAll = state.masterOverlayHidden;
    const showGauge = !hideAll && state.panels['combat-gauge'].visible;
    const showBuffs = !hideAll && state.panels['combat-buffs'].visible;

    // Panel 1: Combat Gauge — use canvas rendering for real icons
    const gaugeEl = document.getElementById('panel-combat-gauge');
    if (gaugeEl) gaugeEl.style.display = showGauge ? '' : 'none';
    if (gaugeEl && showGauge) {
        const canvas = document.createElement('canvas');
        gaugeRenderer.renderToCanvas(canvas, state, styleDef);

        // DEV badge when debug mode is active
        if (debugMode) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const text = 'DEV';
                ctx.save();
                ctx.font = 'bold 9px monospace';
                const metrics = ctx.measureText(text);
                const badgeW = metrics.width + 6;
                const badgeH = 13;
                const bx = canvas.width - badgeW - 3;
                const by = 3;
                ctx.fillStyle = 'rgba(30, 0, 0, 0.6)';
                ctx.fillRect(bx, by, badgeW, badgeH);
                ctx.fillStyle = 'rgba(255, 100, 100, 0.7)';
                ctx.fillText(text, bx + 3, by + 10);
                ctx.restore();
            }
        }

        gaugeEl.innerHTML = '';
        canvas.style.imageRendering = 'pixelated';
        gaugeEl.appendChild(canvas);
    }

    // Panel 2: Combat Buffs
    const buffsEl = document.getElementById('panel-combat-buffs');
    if (buffsEl) buffsEl.style.display = showBuffs ? '' : 'none';
    if (buffsEl && showBuffs) {
        combatBuffsRenderer.renderToHTML(buffsEl, state);
    }

}

// --- App mode flag ---
let isDemoMode = false;

// --- Initialization ---

/**
 * Diagnostic heartbeat. Logs one line every DIAG_INTERVAL_MS while debug mode is on.
 *
 * Captures heap size, store subscriber count, debug log DOM size, session frames count,
 * read cycle count, and uptime. Used to spot memory leaks and resource accumulation
 * over long sessions. A single line per minute is cheap and gives a clear time series.
 */
function logDiagnosticSnapshot(): void {
    if (!debugMode) return;

    const uptime = Math.round((Date.now() - APP_START_TIME) / 1000);

    // Chrome-specific perf API. Available in Alt1's Chromium browser.
    // Falls back to "n/a" on browsers that don't expose it.
    const memInfo = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heap = memInfo
        ? `${(memInfo.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB`
        : 'n/a';

    const subs = store.getSubscriberCount();

    const debugOutEl = document.getElementById('debug-output');
    const dom = debugOutEl ? debugOutEl.childElementCount : 0;

    const frames = sessionFrames.length;

    log(`[Diag] uptime=${uptime}s cycles=${readCount} heap=${heap} sub=${subs} dom=${dom} frames=${frames}`, 'debug');
}

function startDiagnosticHeartbeat(): void {
    if (diagInterval) return;
    diagInterval = setInterval(logDiagnosticSnapshot, DIAG_INTERVAL_MS);
}

function stopDiagnosticHeartbeat(): void {
    if (diagInterval) {
        clearInterval(diagInterval);
        diagInterval = null;
    }
}

function init(): void {
    log('Initializing Buff Tracker v0.6.0 (overlay refactor)');
    log(`RS Scaling: ${getRsScaling()}`);

    // Initialize renderers
    gaugeRenderer = createGaugeRenderer(store.getState().overlayStyle);
    currentRendererStyle = store.getState().overlayStyle;
    combatBuffsRenderer = new CombatBuffsRenderer();

    // Initialize settings panel (apply default buff tracking modes)
    initSettings();

    // Initialize alarm system (subscribes to store for state transition detection)
    alarmManager.init();

    // Wire up buttons
    document.getElementById('btn-detect')?.addEventListener('click', onDetectClick);
    document.getElementById('btn-calibrate')?.addEventListener('click', onCalibrateClick);
    document.getElementById('btn-settings')?.addEventListener('click', onSettingsClick);
    document.getElementById('btn-settings-back')?.addEventListener('click', closeSettings);

    // Inject the master "Hide All Overlays" toggle into the status bar
    installMasterOverlayToggle();

    // Register debug mode toggle callback
    setDebugModeToggleCallback((enabled: boolean) => {
        debugMode = enabled;
        setDebugLogEnabled(enabled);
        debugPaused = false;
        if (enabled) {
            injectDebugUI();
            startDiagnosticHeartbeat();
        } else {
            removeDebugUI();
            stopDiagnosticHeartbeat();
        }
    });

    // Inject debug UI if debug mode was persisted
    if (debugMode) {
        injectDebugUI();
        startDiagnosticHeartbeat();
    }

    // Expose verboseDebug toggle on window for console access
    Object.defineProperty(window, 'verboseDebug', {
        get: () => verboseDebug,
        set: (v: boolean) => { verboseDebug = v; log(`verboseDebug = ${v}`, 'info'); },
    });

    document.getElementById('btn-cycle')?.addEventListener('click', () => {
        if (isDemoMode) {
            cycleDemoStyle();
        } else {
            // Live mode: cycle style and clear abilities
            const styles: CombatStyle[] = ['necromancy', 'magic', 'ranged', 'melee'];
            const current = store.getState().combatStyle;
            const idx = styles.indexOf(current);
            const next = styles[(idx + 1) % styles.length];
            store.setCombatStyle(next);
            store.clearAbilities();
        }
    });

    // Set initial panel visibility
    updatePanelVisibility();

    if (window.alt1) {
        // --- Alt1 Mode: overlay renders on game screen, app window is controls only ---
        alt1.identifyAppUrl('./appconfig.json');

        if (!alt1.permissionPixel) {
            setStatus('Pixel permission required.', 'error');
            return;
        }

        // Hide HTML panels — overlay manager will render to game screen
        const panelsView = document.getElementById('panels-view');
        if (panelsView) panelsView.style.display = 'none';

        // Show overlay status indicator
        showOverlayStatus();

        // Initialize overlay manager
        overlayManager = new OverlayManager();

        // Subscribe to state changes — only update overlay (no HTML panel rendering)
        store.subscribe(() => {
            // Overlay manager handles rendering on its own interval,
            // but force an immediate render on state change for responsiveness
            if (overlayManager) {
                overlayManager.renderNow();
            }
        });

        // Load reference images, then start detection
        setStatus('Loading reference images...', 'info');
        loadAllRefImages().then(() => {
            const count = Object.keys(getRefImages()).length;
            log(`Loaded ${count} reference images`);

            // Start the overlay render loop
            overlayManager?.start();

            // Small delay to let Alt1 fully link the RS client
            setTimeout(() => {
                initDetection();
            }, 500);
        }).catch(e => {
            log(`Failed to load reference images: ${e}`, 'warn');
            // Proceed anyway
            overlayManager?.start();
            setTimeout(() => {
                initDetection();
            }, 1000);
        });
    } else {
        // --- Browser Mode: render panels as HTML in app window ---
        isDemoMode = true;
        setStatus('Loading icons...', 'info');

        // Load reference images for icon display in gauge
        loadAllRefImages().then(() => {
            const count = Object.keys(getRefImages()).length;
            log(`Demo mode: loaded ${count} reference images`);
            setStatus('Reading...', 'ok');
            renderPanelsToHTML();
        }).catch(() => {
            log('Demo mode: ref images not available (OK for preview)', 'warn');
            setStatus('Reading...', 'ok');
        });

        // Subscribe to state changes — render panels to HTML
        store.subscribe(() => {
            renderPanelsToHTML();
        });

        const appUrl = new URL('./appconfig.json', document.location.href).href;
        const addAppLink = `alt1://addapp/${appUrl}`;

        const notice = document.createElement('div');
        notice.style.cssText = 'font-size: 10px; color: rgba(255,255,255,0.4); padding: 8px 0; text-align: center;';
        notice.innerHTML = `<a href="${addAppLink}" style="color: #818cf8;">Add to Alt1</a> to use live`;
        document.getElementById('app')?.appendChild(notice);

        // Populate with demo data so you can see the gauge
        loadDemoData();
    }
}

/**
 * Demo data definitions for each combat style.
 * These populate the gauge in browser preview mode so you can see
 * all three styles without Alt1 connected.
 */
interface DemoAbility {
    id: string;
    active: boolean;
    time?: number;
    stacks?: number;
}

interface DemoStyleData {
    style: CombatStyle;
    abilities: DemoAbility[];
}

const DEMO_DATA: DemoStyleData[] = [
    {
        style: 'necromancy',
        abilities: [
            { id: 'living_death', active: true, time: 24 },
            { id: 'darkness', active: true, time: 54 },
            { id: 'threads', active: true, time: 23 },
            { id: 'split_soul_necro', active: false },
            { id: 'invoke_death', active: false },
            { id: 'bloat', active: false },
            { id: 'souls', active: true, stacks: 5 },
            { id: 'necrosis', active: true, stacks: 12 },
            { id: 'skeleton', active: true, time: 45 },
            { id: 'zombie', active: true, time: 45 },
            { id: 'ghost', active: false },
            { id: 'phantom', active: false },
        ],
    },
    {
        style: 'magic',
        abilities: [
            { id: 'sunshine', active: true, time: 28 },
            { id: 'greater_sunshine', active: false },
            { id: 'instability', active: false },
            { id: 'tsunami', active: true, time: 15 },
            { id: 'soulfire', active: false },
            { id: 'blood_tithe', active: true, stacks: 1 },
            { id: 'glacial_embrace', active: false },
        ],
    },
    {
        style: 'ranged',
        abilities: [
            { id: 'deaths_swiftness', active: true, time: 22 },
            { id: 'greater_deaths_swiftness', active: false },
            { id: 'crystal_rain', active: false },
            { id: 'split_soul_ranged', active: true, time: 31 },
            { id: 'perfect_equilibrium', active: true, stacks: 4 },
            { id: 'balance_by_force', active: false },
            { id: 'searing_winds', active: true, time: 4 },
            { id: 'shadow_imbued', active: false },
        ],
    },
    {
        style: 'melee',
        abilities: [
            { id: 'berserk', active: true, time: 16 },
            { id: 'greater_barge', active: false },
            { id: 'natural_instinct', active: false },
            { id: 'slaughter', active: true, time: 5 },
            { id: 'assault', active: false },
            { id: 'destroy', active: false },
            { id: 'chaos_roar', active: true, time: 3 },
            { id: 'pulverise', active: false },
            { id: 'bloodlust', active: true, stacks: 6 },
        ],
    },
];

/**
 * Demo data for combat buffs panel (Panel 2).
 */
interface DemoBuffEntry {
    id: string;
    name: string;
    mode: 'track' | 'monitor';
    active: boolean;
    time: number;
}

const DEMO_COMBAT_BUFFS: DemoBuffEntry[] = [
    { id: 'elder_overload', name: 'Elder Overload', mode: 'track', active: true, time: 272 },      // 4:32
    { id: 'weapon_poison', name: 'Weapon Poison', mode: 'track', active: true, time: 495 },        // 8:15
    { id: 'prayer_renewal', name: 'Prayer Renewal', mode: 'track', active: true, time: 125 },      // 2:05
    { id: 'aura', name: 'Aura', mode: 'track', active: false, time: 0 },                           // EXPIRED
    { id: 'scripture_of_ful', name: 'Scripture of Ful', mode: 'monitor', active: true, time: 0 },   // Active (no timer)
];

let demoInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Load demo data for the given combat style.
 * Clears existing state and populates with sample data.
 */
function loadDemoStyleData(style: CombatStyle): void {
    store.clearAbilities();
    store.setCombatStyle(style);

    const data = DEMO_DATA.find(d => d.style === style);
    if (!data) return;

    const now = Date.now();

    for (const ability of data.abilities) {
        store.updateAbility(ability.id, {
            active: ability.active,
            time: ability.time || 0,
            stacks: ability.stacks || 0,
            lastSeen: now,
        });
    }
}

/**
 * Load demo data for combat buffs panel.
 */
function loadDemoCombatBuffs(): void {
    for (const buff of DEMO_COMBAT_BUFFS) {
        // Set tracking mode
        store.setBuffTrackMode(buff.id, buff.mode);

        // Set ability state (combat buffs use the main abilities store)
        store.updateAbility(buff.id, {
            active: buff.active,
            time: buff.time,
            stacks: 0,
            lastSeen: Date.now(),
        });
    }
}

/**
 * Cycle to the next demo style. Used by the Cycle Style button in demo mode.
 */
function cycleDemoStyle(): void {
    const styles: CombatStyle[] = ['necromancy', 'magic', 'ranged', 'melee'];
    const current = store.getState().combatStyle;
    const idx = styles.indexOf(current);
    const next = styles[(idx + 1) % styles.length];
    loadDemoStyleData(next);
    // Re-load combat buffs demo data each time style changes
    loadDemoCombatBuffs();
}

/**
 * Load demo data so the gauge is visible in browser preview mode.
 * Starts with necromancy and enables style cycling + timer countdown.
 */
function loadDemoData(): void {
    // Start with necromancy
    loadDemoStyleData('necromancy');

    // Load combat buffs demo data
    loadDemoCombatBuffs();

    // Simulate timer countdown every second
    demoInterval = setInterval(() => {
        const state = store.getState();
        let anyChanged = false;

        // Count down combat ability timers
        for (const [id, ability] of Object.entries(state.abilities)) {
            if (ability.active && ability.time > 0) {
                const newTime = ability.time - 1;
                store.updateAbility(id, {
                    time: newTime,
                    active: newTime > 0,
                });
                anyChanged = true;
            }
        }

        // If all combat timers expired, reload the current style's demo data
        // so the demo keeps cycling visually
        if (!anyChanged) {
            const currentStyle = state.combatStyle;
            const data = DEMO_DATA.find(d => d.style === currentStyle);
            if (data) {
                const hasTimers = data.abilities.some(a => a.time && a.time > 0);
                if (hasTimers) {
                    setTimeout(() => {
                        loadDemoStyleData(currentStyle);
                        loadDemoCombatBuffs();
                    }, 2000);
                }
            }
        }
    }, 1000);
}

// Export for UMD access (window.BuffTracker.*)
export { runDetection, stopReading, startReading };

// Start the app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
