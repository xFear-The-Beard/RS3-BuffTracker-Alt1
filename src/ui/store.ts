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
    overlayStyle: OverlayStyle;
    combatBuffTracking: Record<string, BuffTrackMode>;
    // User settings
    noSoulboundLantern: boolean;
    /** Overlay scale factor (0.5 to 2.0, default 1.0) */
    overlayScale: number;
    /** Ability IDs hidden from the gauge */
    hiddenAbilities: string[];
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

function savePanelData(panels: Record<PanelId, PanelState>, overlayStyle: OverlayStyle): void {
    try {
        const data: SavedPanelData = { panels, overlayStyle };
        localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(data));
    } catch {
        // Ignore write errors
    }
}

function createDefaultPanels(): Record<PanelId, PanelState> {
    return {
        'combat-gauge': { visible: true, x: 100, y: 100 },
        'combat-buffs': { visible: true, x: 100, y: 450 },
    };
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
            combatStyle: 'necromancy',
            autoDetectStyle: true,
            abilities: {},
            isReading: false,
            lastReadTime: 0,
            panels: saved.panels || defaultPanels,
            overlayStyle: saved.overlayStyle || 'modern',
            combatBuffTracking: {},
            noSoulboundLantern: loadUserSetting('noSoulboundLantern') === 'true',
            overlayScale: parseFloat(loadUserSetting('overlayScale') || '1.0') || 1.0,
            hiddenAbilities: JSON.parse(loadUserSetting('hiddenAbilities') || '[]'),
        };
    }

    getState(): AppState {
        return this.state;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    private persistPanels(): void {
        savePanelData(this.state.panels, this.state.overlayStyle);
    }

    /**
     * Update combat style.
     */
    setCombatStyle(style: CombatStyle): void {
        if (this.state.combatStyle !== style) {
            this.state = { ...this.state, combatStyle: style };
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
     * Set buff tracking mode for a specific ability.
     */
    setBuffTrackMode(id: string, mode: BuffTrackMode): void {
        this.state = {
            ...this.state,
            combatBuffTracking: {
                ...this.state.combatBuffTracking,
                [id]: mode,
            },
        };
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
