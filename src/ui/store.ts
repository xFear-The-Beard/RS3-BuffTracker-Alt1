import { CombatStyle } from '../data/abilities';

/**
 * State for a single tracked ability.
 */
export interface AbilityState {
    active: boolean;
    time: number;          // seconds remaining (timer type)
    stacks: number;        // stack count (stacks type)
    isOnCooldown: boolean;
    cooldownDuration: number;
    /** Seconds remaining on internal cooldown (computed from castTimestamp or on-expiry start) */
    cooldownRemaining: number;
    /** Timestamp when ability was first detected this activation cycle (for CD-on-cast) */
    castTimestamp: number;
    lastSeen: number;      // timestamp of last detection
}


// --- Panel Management Types ---

export type PanelId = 'combat-gauge' | 'combat-buffs';
export type OverlayStyle = 'compact' | 'classic' | 'modern' | 'themed' | 'themed-frames';
export type BuffTrackMode = 'off' | 'monitor' | 'track';

export interface PanelState {
    visible: boolean;
    x: number;
    y: number;
}

/** Background/foreground transparency pair for a single renderer pass. */
export interface OpacityPair {
    background: number;
    foreground: number;
}

/** Per-combat-style transparency settings for the combat gauge. */
export type StyleOpacityMap = Record<CombatStyle, OpacityPair>;

/**
 * Full app state.
 */
export interface AppState {
    combatStyle: CombatStyle;
    autoDetectStyle: boolean;
    abilities: Record<string, AbilityState>;
    isReading: boolean;
    lastReadTime: number;
    // Panel management
    panels: Record<PanelId, PanelState>;
    /** Master kill switch - when true, ALL overlays are hidden regardless of per-panel visibility. Per-panel visible state is preserved so flipping this back to false restores exactly what was visible before. */
    masterOverlayHidden: boolean;
    overlayStyle: OverlayStyle;
    combatBuffTracking: Record<string, BuffTrackMode>;
    // User settings
    noSoulboundLantern: boolean;
    /** Overlay scale factor (0.5 to 2.0, default 1.0) */
    overlayScale: number;
    /** Per-combat-style transparency pairs (background/foreground) for the gauge overlay. Clamped 0.05-1.0. */
    styleOpacity: StyleOpacityMap;
    /** Transparency pair for the combat buffs panel (not per-style, shared). Clamped 0.05-1.0. */
    combatBuffsOpacity: OpacityPair;
    /** Ability IDs hidden from the gauge */
    hiddenAbilities: string[];
    /** Set when a saved calibration is older than 7 days. Banner dismissed for the current session by setCalibrationStaleDismissed. */
    calibrationStale: boolean;
    /** Whether the stale-calibration banner has been dismissed for this session. */
    calibrationStaleDismissed: boolean;
}

type Listener = (state: AppState) => void;

const PANELS_STORAGE_KEY = 'buffTracker_panels';
const USER_SETTINGS_KEY = 'buffTracker_settings';

function loadUserSetting(key: string): string | null {
    try {
        const raw = localStorage.getItem(USER_SETTINGS_KEY);
        if (raw) { const data = JSON.parse(raw); return data[key] ?? null; }
    } catch { /* ignore */ }
    return null;
}

function saveUserSetting(key: string, value: string): void {
    try {
        const raw = localStorage.getItem(USER_SETTINGS_KEY);
        const data = raw ? JSON.parse(raw) : {};
        data[key] = value;
        localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
}

interface SavedPanelData {
    panels?: Record<PanelId, PanelState>;
    overlayStyle?: OverlayStyle;
    masterOverlayHidden?: boolean;
}

function loadPanelData(): SavedPanelData {
    try {
        const raw = localStorage.getItem(PANELS_STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as SavedPanelData;
        }
    } catch {
        // Ignore parse errors
    }
    return {};
}

function savePanelData(panels: Record<PanelId, PanelState>, overlayStyle: OverlayStyle, masterOverlayHidden: boolean): void {
    try {
        const data: SavedPanelData = { panels, overlayStyle, masterOverlayHidden };
        localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(data));
    } catch {
        // Ignore write errors
    }
}

function createDefaultPanels(): Record<PanelId, PanelState> {
    return {
        'combat-gauge': { visible: true, x: 100, y: 100 },
        // Default off until the combat buffs panel is fully wired  -
        // shipping it visible-by-default would surface an empty/static
        // overlay to fresh users with nothing to interact with.
        'combat-buffs': { visible: false, x: 100, y: 450 },
    };
}

/**
 * Read the saved combat style from user settings, validating it against
 * the four known styles before returning. Falls back to 'necromancy' if
 * nothing is saved or the saved value is unrecognised (e.g. corrupted
 * localStorage or a future style that doesn't exist yet on this build).
 */
function loadCombatStyle(): CombatStyle {
    const saved = loadUserSetting('combatStyle');
    if (saved === 'necromancy' || saved === 'magic' || saved === 'ranged' || saved === 'melee') {
        return saved;
    }
    return 'necromancy';
}

/**
 * Read the saved combat-buff tracking modes from user settings. Returns
 * an empty object on parse failure so applyDefaultBuffModes can fill it
 * in from the registry defaults at startup.
 */
function loadCombatBuffTracking(): Record<string, BuffTrackMode> {
    try {
        const raw = loadUserSetting('combatBuffTracking');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch { /* ignore */ }
    return {};
}

// Minimum opacity is 5% so the gauge can never accidentally become fully
// invisible via the sliders. The settings panel is always reachable from
// the app window to restore visibility if needed.
const OPACITY_MIN = 0.05;
const OPACITY_MAX = 1.0;

function clampOpacity(v: number): number {
    if (!Number.isFinite(v)) return 1.0;
    return Math.max(OPACITY_MIN, Math.min(OPACITY_MAX, v));
}

function defaultStyleOpacity(): StyleOpacityMap {
    return {
        necromancy: { background: 1.0, foreground: 1.0 },
        magic:      { background: 1.0, foreground: 1.0 },
        ranged:     { background: 1.0, foreground: 1.0 },
        melee:      { background: 1.0, foreground: 1.0 },
    };
}

function loadStyleOpacity(): StyleOpacityMap {
    const result = defaultStyleOpacity();
    try {
        const raw = loadUserSetting('styleOpacity');
        if (!raw) return result;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return result;
        for (const style of ['necromancy', 'magic', 'ranged', 'melee'] as CombatStyle[]) {
            const saved = parsed[style];
            if (saved && typeof saved === 'object') {
                result[style] = {
                    background: clampOpacity(typeof saved.background === 'number' ? saved.background : 1.0),
                    foreground: clampOpacity(typeof saved.foreground === 'number' ? saved.foreground : 1.0),
                };
            }
        }
    } catch { /* fallback to defaults */ }
    return result;
}

function loadCombatBuffsOpacity(): OpacityPair {
    const defaults: OpacityPair = { background: 1.0, foreground: 1.0 };
    try {
        const raw = loadUserSetting('combatBuffsOpacity');
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return defaults;
        return {
            background: clampOpacity(typeof parsed.background === 'number' ? parsed.background : 1.0),
            foreground: clampOpacity(typeof parsed.foreground === 'number' ? parsed.foreground : 1.0),
        };
    } catch { /* fallback to defaults */ }
    return defaults;
}

/**
 * Lightweight reactive store. No dependencies needed for this.
 */
class Store {
    private state: AppState;
    private listeners: Set<Listener> = new Set();

    constructor() {
        const saved = loadPanelData();
        const defaultPanels = createDefaultPanels();

        this.state = {
            combatStyle: loadCombatStyle(),
            autoDetectStyle: true,
            abilities: {},
            isReading: false,
            lastReadTime: 0,
            panels: saved.panels || defaultPanels,
            masterOverlayHidden: saved.masterOverlayHidden ?? false,
            overlayStyle: saved.overlayStyle || 'modern',
            combatBuffTracking: loadCombatBuffTracking(),
            noSoulboundLantern: loadUserSetting('noSoulboundLantern') === 'true',
            overlayScale: parseFloat(loadUserSetting('overlayScale') || '1.0') || 1.0,
            styleOpacity: loadStyleOpacity(),
            combatBuffsOpacity: loadCombatBuffsOpacity(),
            hiddenAbilities: JSON.parse(loadUserSetting('hiddenAbilities') || '[]'),
            calibrationStale: false,
            calibrationStaleDismissed: false,
        };
    }

    setCalibrationStale(stale: boolean): void {
        if (this.state.calibrationStale !== stale) {
            this.state = { ...this.state, calibrationStale: stale };
            this.notify();
        }
    }

    dismissCalibrationStaleBanner(): void {
        if (!this.state.calibrationStaleDismissed) {
            this.state = { ...this.state, calibrationStaleDismissed: true };
            this.notify();
        }
    }

    getState(): AppState {
        return this.state;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Returns the current number of active subscribers. Used by the diagnostic heartbeat. */
    getSubscriberCount(): number {
        return this.listeners.size;
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    private persistPanels(): void {
        savePanelData(this.state.panels, this.state.overlayStyle, this.state.masterOverlayHidden);
    }

    /**
     * Master kill switch - hides ALL overlays without touching per-panel visibility.
     * When flipped back to false, each panel resumes whatever individual state it had.
     */
    setMasterOverlayHidden(hidden: boolean): void {
        if (this.state.masterOverlayHidden !== hidden) {
            this.state = { ...this.state, masterOverlayHidden: hidden };
            this.persistPanels();
            this.notify();
        }
    }

    /**
     * Update combat style. Persists across sessions via user settings.
     */
    setCombatStyle(style: CombatStyle): void {
        if (this.state.combatStyle !== style) {
            this.state = { ...this.state, combatStyle: style };
            saveUserSetting('combatStyle', style);
            this.notify();
        }
    }

    /**
     * Update an ability's state.
     */
    updateAbility(id: string, update: Partial<AbilityState>): void {
        const current = this.state.abilities[id] || createDefaultAbilityState();
        const next = { ...current, ...update };

        // Only notify if something actually changed
        if (
            current.active !== next.active ||
            current.time !== next.time ||
            current.stacks !== next.stacks ||
            current.isOnCooldown !== next.isOnCooldown
        ) {
            this.state = {
                ...this.state,
                abilities: {
                    ...this.state.abilities,
                    [id]: next,
                },
            };
            this.notify();
        }
    }


    /**
     * Mark that a read cycle occurred.
     */
    setReadingState(isReading: boolean): void {
        this.state = {
            ...this.state,
            isReading,
            lastReadTime: Date.now(),
        };
        this.notify();
    }

    /**
     * Clear all ability states (e.g. on combat style switch).
     */
    clearAbilities(): void {
        this.state = {
            ...this.state,
            abilities: {},
        };
        this.notify();
    }

    // --- Panel Management Methods ---

    /**
     * Set visibility of a panel.
     */
    setPanelVisible(panel: PanelId, visible: boolean): void {
        const current = this.state.panels[panel];
        if (current.visible !== visible) {
            this.state = {
                ...this.state,
                panels: {
                    ...this.state.panels,
                    [panel]: { ...current, visible },
                },
            };
            this.persistPanels();
            this.notify();
        }
    }

    /**
     * Set position of a panel.
     */
    setPanelPosition(panel: PanelId, x: number, y: number): void {
        const current = this.state.panels[panel];
        this.state = {
            ...this.state,
            panels: {
                ...this.state.panels,
                [panel]: { ...current, x, y },
            },
        };
        this.persistPanels();
        this.notify();
    }

    /**
     * Set overlay style.
     */
    setOverlayStyle(style: OverlayStyle): void {
        if (this.state.overlayStyle !== style) {
            this.state = { ...this.state, overlayStyle: style };
            this.persistPanels();
            this.notify();
        }
    }

    setNoSoulboundLantern(value: boolean): void {
        if (this.state.noSoulboundLantern !== value) {
            this.state = { ...this.state, noSoulboundLantern: value };
            saveUserSetting('noSoulboundLantern', String(value));
            this.notify();
        }
    }

    setOverlayScale(scale: number): void {
        const clamped = Math.max(0.5, Math.min(2.0, scale));
        if (this.state.overlayScale !== clamped) {
            this.state = { ...this.state, overlayScale: clamped };
            saveUserSetting('overlayScale', String(clamped));
            this.notify();
        }
    }

    /**
     * Update one layer (background or foreground) of the per-style gauge
     * transparency. Clamped 0.05-1.0 at the store layer so malformed saved
     * state or slider bypass can't fully hide the gauge.
     */
    setStyleOpacityLayer(style: CombatStyle, layer: 'background' | 'foreground', value: number): void {
        const clamped = clampOpacity(value);
        const current = this.state.styleOpacity[style];
        if (current[layer] === clamped) return;
        const updated: OpacityPair = { ...current, [layer]: clamped };
        this.state = {
            ...this.state,
            styleOpacity: {
                ...this.state.styleOpacity,
                [style]: updated,
            },
        };
        saveUserSetting('styleOpacity', JSON.stringify(this.state.styleOpacity));
        this.notify();
    }

    /**
     * Update one layer of the combat buffs panel transparency. Same clamp
     * rules as setStyleOpacityLayer.
     */
    setCombatBuffsOpacityLayer(layer: 'background' | 'foreground', value: number): void {
        const clamped = clampOpacity(value);
        if (this.state.combatBuffsOpacity[layer] === clamped) return;
        this.state = {
            ...this.state,
            combatBuffsOpacity: {
                ...this.state.combatBuffsOpacity,
                [layer]: clamped,
            },
        };
        saveUserSetting('combatBuffsOpacity', JSON.stringify(this.state.combatBuffsOpacity));
        this.notify();
    }

    toggleAbilityVisibility(id: string, visible: boolean): void {
        const hidden = new Set(this.state.hiddenAbilities);
        if (visible) hidden.delete(id); else hidden.add(id);
        const arr = Array.from(hidden);
        this.state = { ...this.state, hiddenAbilities: arr };
        saveUserSetting('hiddenAbilities', JSON.stringify(arr));
        this.notify();
    }

    isAbilityHidden(id: string): boolean {
        return this.state.hiddenAbilities.includes(id);
    }

    /**
     * Set buff tracking mode for a specific ability. Persists across
     * sessions so users don't have to re-disable buffs every restart.
     */
    setBuffTrackMode(id: string, mode: BuffTrackMode): void {
        this.state = {
            ...this.state,
            combatBuffTracking: {
                ...this.state.combatBuffTracking,
                [id]: mode,
            },
        };
        saveUserSetting('combatBuffTracking', JSON.stringify(this.state.combatBuffTracking));
        this.notify();
    }

}

function createDefaultAbilityState(): AbilityState {
    return {
        active: false,
        time: 0,
        stacks: 0,
        isOnCooldown: false,
        cooldownDuration: 0,
        cooldownRemaining: 0,
        castTimestamp: 0,
        lastSeen: 0,
    };
}

/**
 * Singleton store instance.
 */
export const store = new Store();
