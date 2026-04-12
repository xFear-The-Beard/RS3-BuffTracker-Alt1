/**
 * Settings panel renderer and controller.
 * Builds HTML for the settings view, wires event handlers, reads/writes to the store.
 */

import { store, OverlayStyle, BuffTrackMode, PanelId } from './store';
import { COMBAT_STYLES, CombatStyle, getStyleDef } from '../data/abilities';
import { COMBAT_BUFF_CATEGORIES } from '../data/buff-registry';
import { alarmManager, SoundType, STACK_ABILITY_IDS } from './alarm-manager';

// --- Collapsed state tracking (UI-only, not persisted) ---
const collapsedSections: Record<string, boolean> = {};

// Initialize collapsed state from category defaults
for (const cat of COMBAT_BUFF_CATEGORIES) {
    collapsedSections[cat.id] = cat.collapsed;
}
collapsedSections['section-gauge-abilities'] = true;
collapsedSections['section-alarms-global'] = true;
collapsedSections['section-alarms-expiry'] = true;
collapsedSections['section-alarms-stacks'] = true;
collapsedSections['section-alarms-timer'] = true;

/**
 * Initialize the settings panel. Call once on startup.
 * Sets up the initial collapsed states and applies default buff tracking modes.
 */
export function initSettings(): void {
    applyDefaultBuffModes();
}

/**
 * Apply default buff tracking modes from the registry for any buff
 * that doesn't already have a mode set in the store.
 */
function applyDefaultBuffModes(): void {
    const state = store.getState();
    for (const cat of COMBAT_BUFF_CATEGORIES) {
        for (const buff of cat.buffs) {
            if (!(buff.id in state.combatBuffTracking)) {
                store.setBuffTrackMode(buff.id, cat.defaultMode);
            }
        }
    }
}

/**
 * Render the full settings panel HTML into the given container.
 */
export function renderSettings(container: HTMLElement): void {
    const state = store.getState();
    let html = '';

    html += '';

    // Banner: stale calibration warning (top of settings, dismissible per session)
    html += renderStaleCalibrationBanner(state.calibrationStale, state.calibrationStaleDismissed);

    // Section 1: Overlay Style
    html += renderOverlayStyleSection(state.overlayStyle);

    // Section 2: Combat Style
    html += renderCombatStyleSection(state.combatStyle);

    // Section 3: Combat Gauge - Ability Toggles
    html += renderGaugeAbilitiesSection(state.combatStyle);

    // Section 4: Combat Buffs - Tracking Config
    html += renderCombatBuffsSection();

    // Section 5: Alerts & Alarms
    html += renderAlarmsSection();

    // Section 6: Panel Positions
    html += renderPanelPositionsSection();

    // Section 7: Developer Settings
    html += renderDeveloperSettingsSection();

    html += '';

    container.innerHTML = html;

    // Wire up event handlers after rendering
    wireEventHandlers(container);
}

// =====================================================================
// Section Renderers
// =====================================================================

function renderStaleCalibrationBanner(stale: boolean, dismissed: boolean): string {
    if (!stale || dismissed) return '';
    return `
        <div id="stale-calibration-banner" style="
            margin-bottom: 10px; padding: 10px 12px;
            background: rgba(251,191,36,0.10);
            border: 1px solid rgba(251,191,36,0.30);
            border-radius: 6px;
            display: flex; align-items: center; gap: 10px;
            font-size: 11px; color: #fcd34d;
        ">
            <div style="flex:1;">
                Your calibration is more than 7 days old. Click Detect to re-verify if anything looks wrong.
            </div>
            <button id="btn-dismiss-stale-banner" style="
                padding: 4px 10px; font-size: 10px;
                border: 1px solid rgba(251,191,36,0.4);
                border-radius: 3px;
                background: rgba(0,0,0,0.2);
                color: #fcd34d;
                cursor: pointer;
            ">Dismiss</button>
        </div>
    `;
}

function renderOverlayStyleSection(current: OverlayStyle): string {
    const state = store.getState();
    const combatGaugePanel = state.panels['combat-gauge'];
    const styles: Array<{ value: OverlayStyle; label: string; sublabel: string; enabled: boolean }> = [
        { value: 'compact', label: 'A', sublabel: 'Compact', enabled: true },
        { value: 'classic', label: 'B', sublabel: 'Classic', enabled: true },
        { value: 'modern', label: 'C', sublabel: 'Modern', enabled: true },
        { value: 'themed', label: 'D', sublabel: 'Themed', enabled: true },
        { value: 'themed-frames', label: 'E', sublabel: 'Frames', enabled: true },
    ];

    let html = '<div class="settings-section">';
    // Title row: section name on the left, descriptive label + visibility
    // toggle for the Combat Gauge overlay on the right. Mirror of the
    // Combat Buffs Panel header below so the two top-level overlays have
    // matching, discoverable show/hide controls.
    html += `
        <div class="settings-section-title" style="display:flex; align-items:center; justify-content:space-between;">
            <span>Overlay Style</span>
            <span style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:10px; color:rgba(255,255,255,0.6); font-weight:normal;">Toggle Overlay On/Off</span>
                <label class="settings-toggle-switch" title="Show or hide the Combat Gauge overlay">
                    <input type="checkbox" data-panel-vis="combat-gauge" ${combatGaugePanel.visible ? 'checked' : ''}>
                    <span class="settings-toggle-slider"></span>
                </label>
            </span>
        </div>
    `;
    html += '<div class="settings-style-grid">';

    for (const s of styles) {
        const isActive = s.value === current;
        const activeClass = isActive ? ' active' : '';
        const disabledClass = !s.enabled ? ' disabled' : '';
        html += `
            <div class="settings-style-card${activeClass}${disabledClass}" data-style="${s.value}">
                <div class="settings-style-letter">${s.label}</div>
                <div class="settings-style-name">${s.sublabel}</div>
                ${!s.enabled ? '<div class="settings-style-soon">Soon</div>' : ''}
            </div>
        `;
    }

    html += '</div></div>';
    return html;
}

function renderCombatStyleSection(current: CombatStyle): string {
    const styleColors: Record<CombatStyle, string> = {
        necromancy: '#a78bfa',
        magic: '#fbbf24',
        ranged: '#a3e635',
        melee: '#ef4444',
    };

    let html = '<div class="settings-section">';
    html += '<div class="settings-section-title">Combat Style</div>';
    html += '<div class="settings-combat-row">';

    for (const styleDef of COMBAT_STYLES) {
        const isActive = styleDef.id === current;
        const color = styleColors[styleDef.id];
        const activeClass = isActive ? ' active' : '';
        html += `
            <button class="settings-combat-btn${activeClass}" data-combat-style="${styleDef.id}"
                    style="${isActive ? `border-color: ${color}; background: ${color}22; color: ${color};` : ''}">
                <span class="settings-combat-icon">${styleDef.icon}</span>
                <span class="settings-combat-label">${styleDef.name}</span>
            </button>
        `;
    }

    html += '</div>';
    html += '</div>';
    return html;
}

function renderGaugeAbilitiesSection(combatStyle: CombatStyle): string {
    const styleDef = getStyleDef(combatStyle);
    if (!styleDef) return '';

    const sectionId = 'section-gauge-abilities';
    const isCollapsed = collapsedSections[sectionId] !== false;

    let html = '<div class="settings-section">';
    html += renderCollapsibleHeader('Combat Gauge - Ability Toggles', sectionId, isCollapsed);

    if (!isCollapsed) {
        html += '<div class="settings-collapsible-body">';
        html += `<div class="settings-hint">Toggle abilities shown on the ${styleDef.name} gauge.</div>`;

        // Necromancy-specific: Soulbound Lantern toggle
        if (combatStyle === 'necromancy') {
            const checked = store.getState().noSoulboundLantern ? 'checked' : '';
            html += `
                <div class="settings-ability-row" style="margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <span class="settings-ability-name" style="font-size:10px; color:rgba(255,255,255,0.5);">No Soulbound Lantern (3 Souls max)</span>
                    <label class="settings-toggle-switch">
                        <input type="checkbox" data-setting="noSoulboundLantern" ${checked}>
                        <span class="settings-toggle-slider"></span>
                    </label>
                </div>
            `;
        }

        for (const ability of styleDef.abilities) {
            html += `
                <div class="settings-ability-row">
                    <span class="settings-ability-dot" style="background: ${ability.color};"></span>
                    <span class="settings-ability-name">${ability.name}</span>
                    <label class="settings-toggle-switch">
                        <input type="checkbox" data-ability-toggle="${ability.id}" ${store.isAbilityHidden(ability.id) ? '' : 'checked'}>
                        <span class="settings-toggle-slider"></span>
                    </label>
                </div>
            `;
        }

        // Conjures (necromancy) - now part of abilities array
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjureAbilities = styleDef.abilities.filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            html += '<div class="settings-subsection-label">Conjures</div>';
            for (const conjure of conjureAbilities) {
                html += `
                    <div class="settings-ability-row">
                        <span class="settings-ability-dot" style="background: #22c55e;"></span>
                        <span class="settings-ability-name">${conjure.name}</span>
                        <label class="settings-toggle-switch">
                            <input type="checkbox" data-ability-toggle="${conjure.id}" ${store.isAbilityHidden(conjure.id) ? '' : 'checked'}>
                            <span class="settings-toggle-slider"></span>
                        </label>
                    </div>
                `;
            }
        }

        html += '</div>';
    }

    html += '</div>';
    return html;
}

function renderCombatBuffsSection(): string {
    const state = store.getState();
    const combatBuffsPanel = state.panels['combat-buffs'];
    let html = '';

    // Master header: Combat Buffs panel visibility toggle. Surfaced here
    // so users can hide the overlay from where they're already looking
    // instead of having to find Panel Positions & Scale further down.
    // Layout mirrors the Overlay Style header above.
    html += '<div class="settings-section">';
    html += `
        <div class="settings-section-title" style="display:flex; align-items:center; justify-content:space-between;">
            <span>Combat Buffs Panel</span>
            <span style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:10px; color:rgba(255,255,255,0.6); font-weight:normal;">Toggle Combat Buffs Panel On/Off</span>
                <label class="settings-toggle-switch" title="Show or hide the Combat Buffs panel overlay">
                    <input type="checkbox" data-panel-vis="combat-buffs" ${combatBuffsPanel.visible ? 'checked' : ''}>
                    <span class="settings-toggle-slider"></span>
                </label>
            </span>
        </div>
    `;
    html += '</div>';

    for (const cat of COMBAT_BUFF_CATEGORIES) {
        const isCollapsed = collapsedSections[cat.id] !== false;
        const tierLabel = `Tier ${cat.tier}`;

        html += '<div class="settings-section">';
        html += renderCollapsibleHeader(`${cat.label} <span class="settings-tier-badge">${tierLabel}</span>`, cat.id, isCollapsed);

        if (!isCollapsed) {
            html += '<div class="settings-collapsible-body">';

            for (const buff of cat.buffs) {
                const mode = state.combatBuffTracking[buff.id] || cat.defaultMode;
                html += renderThreeWayToggle(buff.id, buff.name, mode);
            }

            html += '</div>';
        }

        html += '</div>';
    }

    return html;
}

function renderPanelPositionsSection(): string {
    const state = store.getState();
    const panels: Array<{ id: PanelId; label: string }> = [
        { id: 'combat-gauge', label: 'Combat Gauge' },
        { id: 'combat-buffs', label: 'Combat Buffs' },
    ];

    const nudgeBtnStyle = 'padding:2px 6px; font-size:10px; border:1px solid rgba(255,255,255,0.1); border-radius:3px; background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.6); cursor:pointer; min-width:20px;';

    let html = '<div class="settings-section">';
    html += '<div class="settings-section-title">Panel Positions & Scale</div>';

    for (const panel of panels) {
        const ps = state.panels[panel.id];
        html += `
            <div style="margin-bottom:6px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3px;">
                    <span style="font-size:10px; color:rgba(255,255,255,0.5);">${panel.label}</span>
                    <label class="settings-toggle-switch" title="Show or hide this panel">
                        <input type="checkbox" data-panel-vis="${panel.id}" ${ps.visible ? 'checked' : ''}>
                        <span class="settings-toggle-slider"></span>
                    </label>
                </div>
                <div style="display:flex; align-items:center; gap:3px; flex-wrap:wrap;">
                    <span style="font-size:9px; color:rgba(255,255,255,0.3); width:12px;">X</span>
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="x" data-delta="-100">\u00AB</button>
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="x" data-delta="-10">\u2190</button>
                    <input type="number" class="settings-position-input" data-panel-pos="${panel.id}" data-axis="x" value="${ps.x}" style="width:50px;">
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="x" data-delta="10">\u2192</button>
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="x" data-delta="100">\u00BB</button>
                </div>
                <div style="display:flex; align-items:center; gap:3px; margin-top:2px;">
                    <span style="font-size:9px; color:rgba(255,255,255,0.3); width:12px;">Y</span>
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="y" data-delta="-100">\u21D1</button>
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="y" data-delta="-10">\u2191</button>
                    <input type="number" class="settings-position-input" data-panel-pos="${panel.id}" data-axis="y" value="${ps.y}" style="width:50px;">
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="y" data-delta="10">\u2193</button>
                    <button style="${nudgeBtnStyle}" data-nudge="${panel.id}" data-axis="y" data-delta="100">\u21D3</button>
                </div>
            </div>
        `;
    }

    // Scale slider
    const scalePercent = Math.round((state.overlayScale || 1.0) * 100);
    html += `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span style="font-size:10px; color:rgba(255,255,255,0.5);">Overlay Scale</span>
                <span style="font-size:11px; color:rgba(255,255,255,0.7); font-family:monospace;" data-scale-display>${scalePercent}%</span>
            </div>
            <input type="range" min="50" max="200" step="10" value="${scalePercent}" data-setting="overlayScale"
                style="width:100%; accent-color:#a78bfa; height:4px;">
        </div>
    `;

    html += `
        <button class="settings-reset-btn" data-action="reset-positions" style="margin-top:8px;">Reset Positions & Scale</button>
    `;

    html += '</div>';
    return html;
}

// =====================================================================
// Alerts & Alarms Section
// =====================================================================

function renderAlarmsSection(): string {
    const aState = alarmManager.getAlarmState();
    let html = '';

    // --- Global Controls ---
    const globalId = 'section-alarms-global';
    const globalCollapsed = collapsedSections[globalId] !== false;

    html += '<div class="settings-section">';
    html += renderCollapsibleHeader('Alerts & Alarms', globalId, globalCollapsed);

    if (!globalCollapsed) {
        html += '<div class="settings-collapsible-body">';

        // Global mute
        html += `
            <div class="alarm-global-row">
                <span class="alarm-label">Global Mute</span>
                <label class="settings-toggle-switch">
                    <input type="checkbox" data-alarm-global="mute" ${aState.globalMute ? 'checked' : ''}>
                    <span class="settings-toggle-slider"></span>
                </label>
            </div>
        `;

        // Master volume
        html += `
            <div class="alarm-global-row">
                <span class="alarm-label">Master Volume</span>
                <input type="range" class="alarm-range" data-alarm-global="volume" min="0" max="100" value="${aState.globalVolume}">
                <span class="alarm-volume-value">${aState.globalVolume}%</span>
            </div>
        `;

        // Test buttons
        html += `
            <div class="alarm-test-row">
                <button class="alarm-test-btn" data-alarm-test="sound">Test Sound</button>
                <button class="alarm-test-btn" data-alarm-test="tts">Test TTS</button>
            </div>
        `;

        html += '</div>';
    }
    html += '</div>';

    // --- Buff Expiry Alerts ---
    const expiryId = 'section-alarms-expiry';
    const expiryCollapsed = collapsedSections[expiryId] !== false;

    html += '<div class="settings-section">';
    html += renderCollapsibleHeader('Buff Expiry Alerts', expiryId, expiryCollapsed);

    if (!expiryCollapsed) {
        html += '<div class="settings-collapsible-body">';
        html += '<div class="settings-hint">Alerts when a tracked buff expires. Only buffs in "Track" mode are shown.</div>';

        const state = store.getState();
        let hasTracked = false;

        for (const cat of COMBAT_BUFF_CATEGORIES) {
            for (const buff of cat.buffs) {
                const mode = state.combatBuffTracking[buff.id];
                if (mode !== 'track') continue;
                hasTracked = true;

                const config = alarmManager.getExpiryAlarm(buff.id);
                html += renderAlarmConfigRow('expiry', buff.id, buff.name, config, `${buff.name} expired`);
            }
        }

        if (!hasTracked) {
            html += '<div class="settings-hint" style="color: rgba(255,255,255,0.2);">No buffs in Track mode. Set buffs to Track above to configure expiry alerts.</div>';
        }

        html += '</div>';
    }
    html += '</div>';

    // --- Stack Threshold Alerts ---
    const stacksId = 'section-alarms-stacks';
    const stacksCollapsed = collapsedSections[stacksId] !== false;

    html += '<div class="settings-section">';
    html += renderCollapsibleHeader('Stack Threshold Alerts', stacksId, stacksCollapsed);

    if (!stacksCollapsed) {
        html += '<div class="settings-collapsible-body">';
        html += '<div class="settings-hint">Alert when stack-type abilities reach a threshold.</div>';

        for (const meta of STACK_ABILITY_IDS) {
            const config = alarmManager.getStackAlarm(meta.id);
            html += renderStackAlarmRow(meta.id, meta.name, meta.maxStacks, config);
        }

        html += '</div>';
    }
    html += '</div>';

    // --- Timer Warnings ---
    const timerId = 'section-alarms-timer';
    const timerCollapsed = collapsedSections[timerId] !== false;

    html += '<div class="settings-section">';
    html += renderCollapsibleHeader('Timer Warnings', timerId, timerCollapsed);

    if (!timerCollapsed) {
        html += '<div class="settings-collapsible-body">';
        html += '<div class="settings-hint">Warn before tracked buffs expire.</div>';

        // Global warning seconds
        html += `
            <div class="alarm-global-row">
                <span class="alarm-label">Default warn seconds</span>
                <input type="number" class="alarm-number-input" data-alarm-global="timer-seconds"
                    value="${aState.timerWarningGlobalSeconds}" min="0" max="600" step="5">
            </div>
        `;

        // Per-buff timer warnings (only tracked buffs)
        const state = store.getState();
        let hasTracked = false;

        for (const cat of COMBAT_BUFF_CATEGORIES) {
            for (const buff of cat.buffs) {
                const mode = state.combatBuffTracking[buff.id];
                if (mode !== 'track') continue;
                hasTracked = true;

                const config = alarmManager.getTimerWarning(buff.id);
                html += renderTimerWarningRow(buff.id, buff.name, config);
            }
        }

        if (!hasTracked) {
            html += '<div class="settings-hint" style="color: rgba(255,255,255,0.2);">No buffs in Track mode.</div>';
        }

        html += '</div>';
    }
    html += '</div>';

    return html;
}

/**
 * Render a single alarm config row for expiry alerts.
 */
function renderAlarmConfigRow(
    alarmType: string,
    buffId: string,
    name: string,
    config: { enabled: boolean; ttsEnabled: boolean; ttsMessage: string; soundEnabled: boolean; soundType: SoundType; volumePercent: number },
    defaultTtsText: string,
): string {
    const soundOptions: SoundType[] = ['beep', 'chime', 'alert'];

    let html = `<div class="alarm-config-block" data-alarm-type="${alarmType}" data-alarm-buff="${buffId}">`;

    // Row 1: name + enable toggle
    html += `
        <div class="alarm-config-header">
            <span class="alarm-config-name">${name}</span>
            <label class="settings-toggle-switch">
                <input type="checkbox" data-alarm-field="enabled" ${config.enabled ? 'checked' : ''}>
                <span class="settings-toggle-slider"></span>
            </label>
        </div>
    `;

    // Row 2: sound options (only visible when enabled)
    if (config.enabled) {
        html += '<div class="alarm-config-details">';

        // Sound toggle + type
        html += `
            <div class="alarm-detail-row">
                <label class="alarm-mini-toggle">
                    <input type="checkbox" data-alarm-field="soundEnabled" ${config.soundEnabled ? 'checked' : ''}>
                    <span class="alarm-mini-label">Sound</span>
                </label>
                <select class="alarm-select" data-alarm-field="soundType">
                    ${soundOptions.map(s => `<option value="${s}" ${config.soundType === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
                </select>
            </div>
        `;

        // TTS toggle + custom message
        html += `
            <div class="alarm-detail-row">
                <label class="alarm-mini-toggle">
                    <input type="checkbox" data-alarm-field="ttsEnabled" ${config.ttsEnabled ? 'checked' : ''}>
                    <span class="alarm-mini-label">TTS</span>
                </label>
                <input type="text" class="alarm-text-input" data-alarm-field="ttsMessage"
                    value="${escapeHtml(config.ttsMessage)}" placeholder="${escapeHtml(defaultTtsText)}">
            </div>
        `;

        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Render a stack alarm config row.
 */
function renderStackAlarmRow(
    abilityId: string,
    name: string,
    maxStacks: number,
    config: { enabled: boolean; ttsEnabled: boolean; ttsMessage: string; soundEnabled: boolean; soundType: SoundType; volumePercent: number; threshold: number },
): string {
    const soundOptions: SoundType[] = ['beep', 'chime', 'alert'];

    let html = `<div class="alarm-config-block" data-alarm-type="stacks" data-alarm-buff="${abilityId}">`;

    // Row 1: name + enable + threshold
    html += `
        <div class="alarm-config-header">
            <span class="alarm-config-name">${name}</span>
            <input type="number" class="alarm-threshold-input" data-alarm-field="threshold"
                value="${config.threshold}" min="1" max="${maxStacks}" title="Alert at this many stacks">
            <label class="settings-toggle-switch">
                <input type="checkbox" data-alarm-field="enabled" ${config.enabled ? 'checked' : ''}>
                <span class="settings-toggle-slider"></span>
            </label>
        </div>
    `;

    if (config.enabled) {
        html += '<div class="alarm-config-details">';

        html += `
            <div class="alarm-detail-row">
                <label class="alarm-mini-toggle">
                    <input type="checkbox" data-alarm-field="soundEnabled" ${config.soundEnabled ? 'checked' : ''}>
                    <span class="alarm-mini-label">Sound</span>
                </label>
                <select class="alarm-select" data-alarm-field="soundType">
                    ${soundOptions.map(s => `<option value="${s}" ${config.soundType === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
                </select>
            </div>
        `;

        html += `
            <div class="alarm-detail-row">
                <label class="alarm-mini-toggle">
                    <input type="checkbox" data-alarm-field="ttsEnabled" ${config.ttsEnabled ? 'checked' : ''}>
                    <span class="alarm-mini-label">TTS</span>
                </label>
                <input type="text" class="alarm-text-input" data-alarm-field="ttsMessage"
                    value="${escapeHtml(config.ttsMessage)}" placeholder="${name} threshold reached">
            </div>
        `;

        html += '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Render a timer warning config row.
 */
function renderTimerWarningRow(
    buffId: string,
    name: string,
    config: { enabled: boolean; ttsEnabled: boolean; ttsMessage: string; soundEnabled: boolean; soundType: SoundType; volumePercent: number; warningSeconds: number },
): string {
    const soundOptions: SoundType[] = ['beep', 'chime', 'alert'];

    let html = `<div class="alarm-config-block" data-alarm-type="timer" data-alarm-buff="${buffId}">`;

    html += `
        <div class="alarm-config-header">
            <span class="alarm-config-name">${name}</span>
            <input type="number" class="alarm-threshold-input" data-alarm-field="warningSeconds"
                value="${config.warningSeconds}" min="5" max="600" step="5" title="Warn at this many seconds">
            <label class="settings-toggle-switch">
                <input type="checkbox" data-alarm-field="enabled" ${config.enabled ? 'checked' : ''}>
                <span class="settings-toggle-slider"></span>
            </label>
        </div>
    `;

    if (config.enabled) {
        html += '<div class="alarm-config-details">';

        html += `
            <div class="alarm-detail-row">
                <label class="alarm-mini-toggle">
                    <input type="checkbox" data-alarm-field="soundEnabled" ${config.soundEnabled ? 'checked' : ''}>
                    <span class="alarm-mini-label">Sound</span>
                </label>
                <select class="alarm-select" data-alarm-field="soundType">
                    ${soundOptions.map(s => `<option value="${s}" ${config.soundType === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
                </select>
            </div>
        `;

        html += `
            <div class="alarm-detail-row">
                <label class="alarm-mini-toggle">
                    <input type="checkbox" data-alarm-field="ttsEnabled" ${config.ttsEnabled ? 'checked' : ''}>
                    <span class="alarm-mini-label">TTS</span>
                </label>
                <input type="text" class="alarm-text-input" data-alarm-field="ttsMessage"
                    value="${escapeHtml(config.ttsMessage)}" placeholder="${name} expiring soon">
            </div>
        `;

        html += '</div>';
    }

    html += '</div>';
    return html;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =====================================================================
// Shared Components
// =====================================================================

function renderCollapsibleHeader(title: string, sectionId: string, isCollapsed: boolean): string {
    const arrow = isCollapsed ? '\u25B6' : '\u25BC';
    return `
        <div class="settings-collapsible-header" data-collapse="${sectionId}">
            <span class="settings-collapse-arrow">${arrow}</span>
            <span class="settings-section-title">${title}</span>
        </div>
    `;
}

function renderThreeWayToggle(id: string, name: string, mode: BuffTrackMode): string {
    return `
        <div class="settings-buff-row">
            <span class="settings-buff-name">${name}</span>
            <div class="settings-three-way" data-buff-id="${id}">
                <button class="settings-tw-btn${mode === 'off' ? ' active' : ''}" data-tw-mode="off">Off</button>
                <button class="settings-tw-btn${mode === 'monitor' ? ' active' : ''}" data-tw-mode="monitor">Mon</button>
                <button class="settings-tw-btn${mode === 'track' ? ' active' : ''}" data-tw-mode="track">Track</button>
            </div>
        </div>
    `;
}

// =====================================================================
// Developer Settings Section
// =====================================================================

/** Callback for when debug mode is toggled - set by index.ts */
let onDebugModeToggle: ((enabled: boolean) => void) | null = null;

/** Register the debug mode toggle callback */
export function setDebugModeToggleCallback(cb: (enabled: boolean) => void): void {
    onDebugModeToggle = cb;
}

/** Debug mode state - per-session only, never auto-enabled from localStorage */
let debugModeSessionState = false;

/** Read current debug mode state for rendering */
export function getDebugModeEnabled(): boolean {
    return debugModeSessionState;
}

/** Set debug mode state (called by toggle callback) */
export function setDebugModeState(enabled: boolean): void {
    debugModeSessionState = enabled;
}

function renderDeveloperSettingsSection(): string {
    const sectionId = 'section-developer';
    const isCollapsed = collapsedSections[sectionId] !== false;

    let html = '<div class="settings-section">';
    html += renderCollapsibleHeader('Developer Settings', sectionId, isCollapsed);

    if (!isCollapsed) {
        html += '<div class="settings-collapsible-body">';
        html += '<div class="settings-subsection-label">Advanced</div>';

        const debugEnabled = getDebugModeEnabled();
        html += `
            <div class="settings-ability-row">
                <span class="settings-ability-name">Enable Debug Mode</span>
                <label class="settings-toggle-switch">
                    <input type="checkbox" data-setting="debugMode" ${debugEnabled ? 'checked' : ''}>
                    <span class="settings-toggle-slider"></span>
                </label>
            </div>
        `;

        if (debugEnabled) {
            html += '<div class="settings-hint" style="color: rgba(255,100,100,0.7);">Debug mode active - log panel and dev tools visible below the main UI.</div>';

            // Verbose debug toggle
            const verboseEnabled = typeof (window as any).verboseDebug === 'boolean' && (window as any).verboseDebug;
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; margin-top:4px; border-top:1px solid rgba(255,255,255,0.06);">
                    <span style="font-size:11px; color:rgba(255,255,255,0.7);">Verbose Logging</span>
                    <label class="settings-toggle-switch">
                        <input type="checkbox" data-setting="verboseDebug" ${verboseEnabled ? 'checked' : ''}>
                        <span class="settings-toggle-slider"></span>
                    </label>
                </div>
            `;
            html += '<div style="font-size:9px; color:rgba(255,255,255,0.3); margin-bottom:4px;">Shows per-slot match details and dual-text raw strings.</div>';
        }

        html += '</div>';
    }

    html += '</div>';
    return html;
}

collapsedSections['section-developer'] = true;

// =====================================================================
// Event Wiring
// =====================================================================

function wireEventHandlers(container: HTMLElement): void {
    // Stale calibration banner - dismiss button
    container.querySelector<HTMLButtonElement>('#btn-dismiss-stale-banner')?.addEventListener('click', () => {
        store.dismissCalibrationStaleBanner();
        renderSettings(container);
    });

    // Overlay style cards
    container.querySelectorAll<HTMLElement>('.settings-style-card:not(.disabled)').forEach(card => {
        card.addEventListener('click', () => {
            const style = card.dataset.style as OverlayStyle;
            if (style) {
                store.setOverlayStyle(style);
                renderSettings(container);
            }
        });
    });

    // Combat style buttons
    container.querySelectorAll<HTMLElement>('.settings-combat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const style = btn.dataset.combatStyle as CombatStyle;
            if (style) {
                store.setCombatStyle(style);
                store.clearAbilities();
                renderSettings(container);
            }
        });
    });

    // Soulbound Lantern checkbox
    const lanternCb = container.querySelector<HTMLInputElement>('[data-setting="noSoulboundLantern"]');
    if (lanternCb) {
        lanternCb.addEventListener('change', () => {
            store.setNoSoulboundLantern(lanternCb.checked);
        });
    }

    // Ability visibility toggles
    container.querySelectorAll<HTMLInputElement>('[data-ability-toggle]').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.dataset.abilityToggle;
            if (id) store.toggleAbilityVisibility(id, cb.checked);
        });
    });

    // Collapsible headers
    container.querySelectorAll<HTMLElement>('.settings-collapsible-header').forEach(header => {
        header.addEventListener('click', () => {
            const sectionId = header.dataset.collapse;
            if (sectionId) {
                collapsedSections[sectionId] = !collapsedSections[sectionId];
                renderSettings(container);
            }
        });
    });

    // Three-way toggle buttons (buff tracking mode)
    container.querySelectorAll<HTMLElement>('.settings-three-way').forEach(group => {
        const buffId = group.dataset.buffId;
        if (!buffId) return;

        group.querySelectorAll<HTMLElement>('.settings-tw-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.twMode as BuffTrackMode;
                if (mode && buffId) {
                    store.setBuffTrackMode(buffId, mode);
                    // Update active state locally without full re-render
                    group.querySelectorAll('.settings-tw-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            });
        });
    });

    // Panel position inputs
    container.querySelectorAll<HTMLInputElement>('.settings-position-input').forEach(input => {
        input.addEventListener('change', () => {
            const panelId = input.dataset.panelPos as PanelId;
            const axis = input.dataset.axis as 'x' | 'y';
            if (!panelId || !axis) return;

            const value = parseInt(input.value) || 0;
            const state = store.getState();
            const current = state.panels[panelId];

            if (axis === 'x') {
                store.setPanelPosition(panelId, value, current.y);
            } else {
                store.setPanelPosition(panelId, current.x, value);
            }
        });
    });

    // Panel visibility toggles. Multiple checkboxes can target the same panel
    // (Combat Buffs Panel header + Panel Positions section), so on change we
    // sync all matching checkboxes to keep the UI consistent without a re-render.
    container.querySelectorAll<HTMLInputElement>('[data-panel-vis]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const panelId = checkbox.dataset.panelVis as PanelId;
            if (!panelId) return;
            store.setPanelVisible(panelId, checkbox.checked);
            container.querySelectorAll<HTMLInputElement>(`[data-panel-vis="${panelId}"]`).forEach(other => {
                if (other !== checkbox) other.checked = checkbox.checked;
            });
        });
    });

    // Nudge buttons
    container.querySelectorAll<HTMLElement>('[data-nudge]').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.nudge as PanelId;
            const axis = btn.dataset.axis as 'x' | 'y';
            const delta = parseInt(btn.dataset.delta || '0');
            if (!panelId || !axis) return;

            const current = store.getState().panels[panelId];
            if (axis === 'x') {
                store.setPanelPosition(panelId, current.x + delta, current.y);
            } else {
                store.setPanelPosition(panelId, current.x, current.y + delta);
            }
            // Update the corresponding input value
            const input = container.querySelector<HTMLInputElement>(`[data-panel-pos="${panelId}"][data-axis="${axis}"]`);
            if (input) {
                const ps = store.getState().panels[panelId];
                input.value = String(axis === 'x' ? ps.x : ps.y);
            }
        });
    });

    // Scale slider
    const scaleSlider = container.querySelector<HTMLInputElement>('[data-setting="overlayScale"]');
    if (scaleSlider) {
        scaleSlider.addEventListener('input', () => {
            const percent = parseInt(scaleSlider.value) || 100;
            store.setOverlayScale(percent / 100);
            const display = container.querySelector('[data-scale-display]');
            if (display) display.textContent = `${percent}%`;
        });
    }

    // Reset positions & scale button
    const resetBtn = container.querySelector<HTMLElement>('[data-action="reset-positions"]');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            store.setPanelPosition('combat-gauge', 100, 100);
            store.setPanelPosition('combat-buffs', 100, 450);
            store.setOverlayScale(1.0);
            renderSettings(container);
        });
    }

    // Debug mode toggle
    const debugCb = container.querySelector<HTMLInputElement>('[data-setting="debugMode"]');
    if (debugCb) {
        debugCb.addEventListener('change', () => {
            setDebugModeState(debugCb.checked);
            if (onDebugModeToggle) onDebugModeToggle(debugCb.checked);
            renderSettings(container);
        });
    }

    // Verbose debug toggle
    const verboseCb = container.querySelector<HTMLInputElement>('[data-setting="verboseDebug"]');
    if (verboseCb) {
        verboseCb.addEventListener('change', () => {
            (window as any).verboseDebug = verboseCb.checked;
        });
    }

    // --- Alarm event handlers ---
    wireAlarmHandlers(container);
}

function wireAlarmHandlers(container: HTMLElement): void {
    // Global mute toggle
    const muteToggle = container.querySelector<HTMLInputElement>('[data-alarm-global="mute"]');
    if (muteToggle) {
        muteToggle.addEventListener('change', () => {
            alarmManager.setGlobalMute(muteToggle.checked);
        });
    }

    // Global volume slider
    const volSlider = container.querySelector<HTMLInputElement>('[data-alarm-global="volume"]');
    if (volSlider) {
        const volLabel = volSlider.nextElementSibling as HTMLElement | null;
        volSlider.addEventListener('input', () => {
            const val = parseInt(volSlider.value) || 0;
            alarmManager.setGlobalVolume(val);
            if (volLabel) volLabel.textContent = `${val}%`;
        });
    }

    // Global timer warning seconds
    const timerSecondsInput = container.querySelector<HTMLInputElement>('[data-alarm-global="timer-seconds"]');
    if (timerSecondsInput) {
        timerSecondsInput.addEventListener('change', () => {
            alarmManager.setTimerWarningGlobalSeconds(parseInt(timerSecondsInput.value) || 30);
        });
    }

    // Test sound button
    const testSoundBtn = container.querySelector<HTMLElement>('[data-alarm-test="sound"]');
    if (testSoundBtn) {
        testSoundBtn.addEventListener('click', () => {
            const vol = alarmManager.getAlarmState().globalVolume;
            alarmManager.playTone('beep', vol);
        });
    }

    // Test TTS button
    const testTtsBtn = container.querySelector<HTMLElement>('[data-alarm-test="tts"]');
    if (testTtsBtn) {
        testTtsBtn.addEventListener('click', () => {
            alarmManager.speak('Test alert');
        });
    }

    // Per-alarm config blocks (expiry, stacks, timer)
    container.querySelectorAll<HTMLElement>('.alarm-config-block').forEach(block => {
        const alarmType = block.dataset.alarmType;
        const buffId = block.dataset.alarmBuff;
        if (!alarmType || !buffId) return;

        // Enabled toggle
        const enabledCb = block.querySelector<HTMLInputElement>('[data-alarm-field="enabled"]');
        if (enabledCb) {
            enabledCb.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'enabled', enabledCb.checked);
                renderSettings(container); // re-render to show/hide details
            });
        }

        // Sound enabled
        const soundCb = block.querySelector<HTMLInputElement>('[data-alarm-field="soundEnabled"]');
        if (soundCb) {
            soundCb.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'soundEnabled', soundCb.checked);
            });
        }

        // Sound type
        const soundSelect = block.querySelector<HTMLSelectElement>('[data-alarm-field="soundType"]');
        if (soundSelect) {
            soundSelect.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'soundType', soundSelect.value as SoundType);
            });
        }

        // TTS enabled
        const ttsCb = block.querySelector<HTMLInputElement>('[data-alarm-field="ttsEnabled"]');
        if (ttsCb) {
            ttsCb.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'ttsEnabled', ttsCb.checked);
            });
        }

        // TTS message
        const ttsInput = block.querySelector<HTMLInputElement>('[data-alarm-field="ttsMessage"]');
        if (ttsInput) {
            ttsInput.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'ttsMessage', ttsInput.value);
            });
        }

        // Threshold (stacks)
        const thresholdInput = block.querySelector<HTMLInputElement>('[data-alarm-field="threshold"]');
        if (thresholdInput) {
            thresholdInput.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'threshold', parseInt(thresholdInput.value) || 1);
            });
        }

        // Warning seconds (timer)
        const warnSecondsInput = block.querySelector<HTMLInputElement>('[data-alarm-field="warningSeconds"]');
        if (warnSecondsInput) {
            warnSecondsInput.addEventListener('change', () => {
                updateAlarmField(alarmType, buffId, 'warningSeconds', parseInt(warnSecondsInput.value) || 30);
            });
        }
    });
}

/**
 * Route alarm field updates to the correct alarmManager setter.
 */
function updateAlarmField(alarmType: string, buffId: string, field: string, value: boolean | string | number): void {
    const update: Record<string, boolean | string | number> = { [field]: value };

    switch (alarmType) {
        case 'expiry':
            alarmManager.setExpiryAlarm(buffId, update);
            break;
        case 'stacks':
            alarmManager.setStackAlarm(buffId, update as any);
            break;
        case 'timer':
            alarmManager.setTimerWarning(buffId, update as any);
            break;
    }
}
