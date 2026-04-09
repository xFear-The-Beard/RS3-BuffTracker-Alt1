/**
 * Alarm/Alert system with TTS and Web Audio API support.
 * Monitors store state transitions to fire audio/speech alerts for:
 *  - Buff expiry (tracked buff goes active -> inactive)
 *  - Stack thresholds (stack count reaches a configured value)
 *  - Timer warnings (buff timer drops below a configured seconds threshold)
 */

import { store, AppState, AbilityState } from './store';
import { COMBAT_STYLES, isStackingDisplay } from '../data/abilities';
import { COMBAT_BUFF_CATEGORIES } from '../data/buff-registry';

// =====================================================================
// Types
// =====================================================================

export type SoundType = 'beep' | 'chime' | 'alert';

export interface AlarmConfig {
    enabled: boolean;
    ttsEnabled: boolean;
    ttsMessage: string;       // custom TTS text; empty string = use auto-generated default
    soundEnabled: boolean;
    soundType: SoundType;
    volumePercent: number;    // 0-100
}

export interface StackAlarmConfig extends AlarmConfig {
    threshold: number;        // alert when stacks >= this
}

export interface TimerWarningConfig extends AlarmConfig {
    warningSeconds: number;   // alert when timer <= this many seconds
}

export interface AlarmState {
    globalMute: boolean;
    globalVolume: number;     // 0-100
    expiryAlarms: Record<string, AlarmConfig>;
    stackAlarms: Record<string, StackAlarmConfig>;
    timerWarnings: Record<string, TimerWarningConfig>;
    timerWarningGlobalSeconds: number; // default seconds for timer warnings
}

/** Internal tracking for alarm cooldowns and timer-warning "fired" flags. */
interface AlarmCooldowns {
    /** alarm_key -> timestamp of last fire */
    firedAlarms: Record<string, number>;
    /** For timer warnings: track whether the warning already fired for this active period */
    timerWarningFired: Record<string, boolean>;
}

// =====================================================================
// Constants
// =====================================================================

const STORAGE_KEY = 'buffTracker_alarms';
const COOLDOWN_MS = 5000; // 5 seconds between repeated identical alarms

/** Stack-type ability IDs and their metadata (for settings rendering). */
export const STACK_ABILITY_IDS: Array<{ id: string; name: string; maxStacks: number }> = [];

// Populate from all combat styles
for (const style of COMBAT_STYLES) {
    for (const ability of style.abilities) {
        if (isStackingDisplay(ability.type)) {
            // Avoid duplicates
            if (!STACK_ABILITY_IDS.find(s => s.id === ability.id)) {
                STACK_ABILITY_IDS.push({
                    id: ability.id,
                    name: ability.name,
                    maxStacks: ability.maxStacks || 12,
                });
            }
        }
    }
}

// =====================================================================
// Alarm Manager (singleton)
// =====================================================================

class AlarmManager {
    private alarmState: AlarmState;
    private cooldowns: AlarmCooldowns;
    private prevAppState: AppState | null = null;
    private audioCtx: AudioContext | null = null;
    /** Set of buff IDs that had a visual flash recently. UI reads this to apply CSS class. */
    public flashingBuffs: Set<string> = new Set();

    constructor() {
        this.alarmState = this.createDefaultState();
        this.cooldowns = { firedAlarms: {}, timerWarningFired: {} };
    }

    // -----------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------

    init(): void {
        this.loadConfig();

        // Capture initial state so first tick doesn't fire spurious alarms
        this.prevAppState = store.getState();

        // Subscribe to store changes
        store.subscribe((newState: AppState) => {
            this.checkAlarms(this.prevAppState, newState);
            this.prevAppState = newState;
        });
    }

    // -----------------------------------------------------------------
    // State accessors
    // -----------------------------------------------------------------

    getAlarmState(): AlarmState {
        return this.alarmState;
    }

    setGlobalMute(mute: boolean): void {
        this.alarmState.globalMute = mute;
        this.saveConfig();
    }

    setGlobalVolume(vol: number): void {
        this.alarmState.globalVolume = Math.max(0, Math.min(100, vol));
        this.saveConfig();
    }

    setTimerWarningGlobalSeconds(seconds: number): void {
        this.alarmState.timerWarningGlobalSeconds = Math.max(0, Math.min(600, seconds));
        this.saveConfig();
    }

    // -- Expiry alarm accessors --

    getExpiryAlarm(buffId: string): AlarmConfig {
        if (!this.alarmState.expiryAlarms[buffId]) {
            this.alarmState.expiryAlarms[buffId] = this.createDefaultAlarmConfig();
        }
        return this.alarmState.expiryAlarms[buffId];
    }

    setExpiryAlarm(buffId: string, config: Partial<AlarmConfig>): void {
        const current = this.getExpiryAlarm(buffId);
        this.alarmState.expiryAlarms[buffId] = { ...current, ...config };
        this.saveConfig();
    }

    // -- Stack alarm accessors --

    getStackAlarm(abilityId: string): StackAlarmConfig {
        if (!this.alarmState.stackAlarms[abilityId]) {
            const meta = STACK_ABILITY_IDS.find(s => s.id === abilityId);
            this.alarmState.stackAlarms[abilityId] = {
                ...this.createDefaultAlarmConfig(),
                threshold: meta ? meta.maxStacks : 5,
            };
        }
        return this.alarmState.stackAlarms[abilityId];
    }

    setStackAlarm(abilityId: string, config: Partial<StackAlarmConfig>): void {
        const current = this.getStackAlarm(abilityId);
        this.alarmState.stackAlarms[abilityId] = { ...current, ...config };
        this.saveConfig();
    }

    // -- Timer warning accessors --

    getTimerWarning(buffId: string): TimerWarningConfig {
        if (!this.alarmState.timerWarnings[buffId]) {
            this.alarmState.timerWarnings[buffId] = {
                ...this.createDefaultAlarmConfig(),
                warningSeconds: this.alarmState.timerWarningGlobalSeconds,
            };
        }
        return this.alarmState.timerWarnings[buffId];
    }

    setTimerWarning(buffId: string, config: Partial<TimerWarningConfig>): void {
        const current = this.getTimerWarning(buffId);
        this.alarmState.timerWarnings[buffId] = { ...current, ...config };
        this.saveConfig();
    }

    // -----------------------------------------------------------------
    // Core alarm logic
    // -----------------------------------------------------------------

    checkAlarms(prevState: AppState | null, newState: AppState): void {
        if (!prevState) return;
        if (this.alarmState.globalMute) return;

        this.checkExpiryAlarms(prevState, newState);
        this.checkStackAlarms(prevState, newState);
        this.checkTimerWarnings(prevState, newState);
    }

    /**
     * Buff expiry: tracked buff transitions from active -> inactive.
     */
    private checkExpiryAlarms(prev: AppState, next: AppState): void {
        for (const [buffId, mode] of Object.entries(next.combatBuffTracking)) {
            if (mode !== 'track') continue;

            const config = this.alarmState.expiryAlarms[buffId];
            if (!config || !config.enabled) continue;

            const prevAbility = prev.abilities[buffId];
            const nextAbility = next.abilities[buffId];

            // Detect active -> inactive transition
            if (prevAbility?.active && nextAbility && !nextAbility.active) {
                const alarmKey = `expiry:${buffId}`;
                if (!this.isCoolingDown(alarmKey)) {
                    const name = this.getBuffDisplayName(buffId);
                    const defaultMsg = `${name} expired`;
                    this.fireAlarm(config, defaultMsg, alarmKey);
                    this.triggerFlash(buffId);
                }
            }
        }
    }

    /**
     * Stack threshold: stacks reach or exceed configured threshold.
     */
    private checkStackAlarms(prev: AppState, next: AppState): void {
        for (const meta of STACK_ABILITY_IDS) {
            const config = this.alarmState.stackAlarms[meta.id];
            if (!config || !config.enabled) continue;

            const prevAbility = prev.abilities[meta.id];
            const nextAbility = next.abilities[meta.id];

            if (!nextAbility) continue;

            const prevStacks = prevAbility?.stacks || 0;
            const nextStacks = nextAbility.stacks;

            // Fire when crossing threshold upward
            if (nextStacks >= config.threshold && prevStacks < config.threshold) {
                const alarmKey = `stacks:${meta.id}:${config.threshold}`;
                if (!this.isCoolingDown(alarmKey)) {
                    const defaultMsg = `${meta.name} at ${nextStacks}`;
                    this.fireAlarm(config, defaultMsg, alarmKey);
                }
            }
        }
    }

    /**
     * Timer warning: buff timer drops below configured threshold while still active.
     */
    private checkTimerWarnings(prev: AppState, next: AppState): void {
        for (const [buffId, mode] of Object.entries(next.combatBuffTracking)) {
            if (mode !== 'track') continue;

            const config = this.alarmState.timerWarnings[buffId];
            if (!config || !config.enabled) continue;
            if (config.warningSeconds <= 0) continue;

            const nextAbility = next.abilities[buffId];
            const prevAbility = prev.abilities[buffId];

            if (!nextAbility || !nextAbility.active || nextAbility.time <= 0) {
                // Buff not active or no timer -- reset the "fired" flag so it can fire again next time
                this.cooldowns.timerWarningFired[buffId] = false;
                continue;
            }

            // Only fire once per active period
            if (this.cooldowns.timerWarningFired[buffId]) continue;

            const prevTime = prevAbility?.time || Infinity;
            const nextTime = nextAbility.time;

            // Crossed below threshold
            if (nextTime <= config.warningSeconds && prevTime > config.warningSeconds) {
                const alarmKey = `timer:${buffId}`;
                if (!this.isCoolingDown(alarmKey)) {
                    const name = this.getBuffDisplayName(buffId);
                    const defaultMsg = `${name} expiring in ${nextTime} seconds`;
                    this.fireAlarm(config, defaultMsg, alarmKey);
                    this.cooldowns.timerWarningFired[buffId] = true;
                }
            }
        }
    }

    // -----------------------------------------------------------------
    // Alarm execution
    // -----------------------------------------------------------------

    fireAlarm(config: AlarmConfig, defaultMessage: string, alarmKey: string): void {
        this.cooldowns.firedAlarms[alarmKey] = Date.now();

        const effectiveVolume = (config.volumePercent / 100) * (this.alarmState.globalVolume / 100);

        if (config.soundEnabled) {
            this.playTone(config.soundType, effectiveVolume * 100);
        }

        if (config.ttsEnabled) {
            const text = config.ttsMessage || defaultMessage;
            this.speak(text, effectiveVolume);
        }
    }

    private isCoolingDown(alarmKey: string): boolean {
        const lastFired = this.cooldowns.firedAlarms[alarmKey];
        if (!lastFired) return false;
        return (Date.now() - lastFired) < COOLDOWN_MS;
    }

    // -----------------------------------------------------------------
    // Audio: Web Audio API tones
    // -----------------------------------------------------------------

    private getAudioContext(): AudioContext {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        return this.audioCtx;
    }

    playTone(type: SoundType, volumePercent: number): void {
        try {
            const ctx = this.getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = Math.max(0, Math.min(1, volumePercent / 100));

            if (type === 'beep') {
                osc.frequency.value = 880;  // A5
                osc.type = 'square';
            } else if (type === 'chime') {
                osc.frequency.value = 1047; // C6
                osc.type = 'sine';
            } else {
                // 'alert'
                osc.frequency.value = 660;  // E5
                osc.type = 'triangle';
            }

            const now = ctx.currentTime;
            // Quick fade-in/out to avoid click
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(volumePercent / 100, now + 0.01);
            gain.gain.linearRampToValueAtTime(0, now + 0.3);

            osc.start(now);
            osc.stop(now + 0.35);
        } catch {
            // Silently ignore audio errors
        }
    }

    // -----------------------------------------------------------------
    // TTS: SpeechSynthesis API
    // -----------------------------------------------------------------

    speak(text: string, volumeFraction?: number): void {
        if (!window.speechSynthesis) return;
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = volumeFraction !== undefined
                ? Math.max(0, Math.min(1, volumeFraction))
                : (this.alarmState.globalVolume / 100);
            window.speechSynthesis.speak(utterance);
        } catch {
            // Silently ignore TTS errors
        }
    }

    // -----------------------------------------------------------------
    // Visual flash
    // -----------------------------------------------------------------

    private triggerFlash(buffId: string): void {
        this.flashingBuffs.add(buffId);
        setTimeout(() => {
            this.flashingBuffs.delete(buffId);
        }, 2000);
    }

    isFlashing(buffId: string): boolean {
        return this.flashingBuffs.has(buffId);
    }

    // -----------------------------------------------------------------
    // Buff name helpers
    // -----------------------------------------------------------------

    private getBuffDisplayName(id: string): string {
        // Try combat buff categories first
        for (const cat of COMBAT_BUFF_CATEGORIES) {
            for (const buff of cat.buffs) {
                if (buff.id === id) return buff.name;
            }
        }
        // Try ability definitions
        for (const style of COMBAT_STYLES) {
            for (const ability of style.abilities) {
                if (ability.id === id) return ability.name;
            }
        }
        // Fallback: format the id
        return id
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    // -----------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------

    saveConfig(): void {
        try {
            const data = {
                globalMute: this.alarmState.globalMute,
                globalVolume: this.alarmState.globalVolume,
                timerWarningGlobalSeconds: this.alarmState.timerWarningGlobalSeconds,
                expiryAlarms: this.alarmState.expiryAlarms,
                stackAlarms: this.alarmState.stackAlarms,
                timerWarnings: this.alarmState.timerWarnings,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            // Ignore write errors
        }
    }

    loadConfig(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;

            const data = JSON.parse(raw);
            if (data.globalMute !== undefined) this.alarmState.globalMute = data.globalMute;
            if (data.globalVolume !== undefined) this.alarmState.globalVolume = data.globalVolume;
            if (data.timerWarningGlobalSeconds !== undefined) {
                this.alarmState.timerWarningGlobalSeconds = data.timerWarningGlobalSeconds;
            }
            if (data.expiryAlarms) {
                this.alarmState.expiryAlarms = { ...this.alarmState.expiryAlarms, ...data.expiryAlarms };
            }
            if (data.stackAlarms) {
                this.alarmState.stackAlarms = { ...this.alarmState.stackAlarms, ...data.stackAlarms };
            }
            if (data.timerWarnings) {
                this.alarmState.timerWarnings = { ...this.alarmState.timerWarnings, ...data.timerWarnings };
            }
        } catch {
            // Ignore parse errors; use defaults
        }
    }

    // -----------------------------------------------------------------
    // Defaults
    // -----------------------------------------------------------------

    private createDefaultState(): AlarmState {
        return {
            globalMute: false,
            globalVolume: 75,
            expiryAlarms: {},
            stackAlarms: {},
            timerWarnings: {},
            timerWarningGlobalSeconds: 30,
        };
    }

    private createDefaultAlarmConfig(): AlarmConfig {
        return {
            enabled: false,
            ttsEnabled: false,
            ttsMessage: '',
            soundEnabled: true,
            soundType: 'beep',
            volumePercent: 80,
        };
    }
}

/**
 * Singleton alarm manager instance.
 */
export const alarmManager = new AlarmManager();
