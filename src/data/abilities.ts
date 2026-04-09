/**
 * Combat style definitions and buff/debuff registry.
 *
 * Ability types (based on Job Gauges architecture):
 *  - 'buff-timer': Screen-read timer from player buff bar (Darkness, Conjures)
 *  - 'stacking-buff': Digit reader output IS the stack count (Residual Souls, Necrosis)
 *  - 'ability': Buff bar while active + internal cooldown countdown
 *               cooldownStart='on-cast': CD starts when buff first appears
 *               cooldownStart='on-expiry': CD starts when buff disappears
 *  - 'enemy-debuff': Detected on enemy target display, not player buff bar
 *
 * Other fields:
 *  - source: 'buff', 'debuff', or 'enemy' (which bar/region to read from)
 *  - cooldownDuration: total cooldown in seconds (for 'ability' type)
 *  - cooldownStart: 'on-cast' or 'on-expiry' — when the CD timer begins
 *  - buffDuration: active buff duration in seconds (for display + CD-on-cast calc)
 *  - internalDuration: hardcoded timer to start when detected (for 'enemy-debuff' like Bloat)
 *  - maxStacks: for stacking-buff, the maximum count
 *  - minMaxStacks: minimum maxStacks without gear modifier (e.g. Residual Souls 3 without Lantern)
 *  - splitAt: for display, insert visual gap at this stack count (e.g. necrosis 6+6)
 *  - group: which AbilityGroup this ability belongs to (set by StyleDef.groups)
 */

export type CombatStyle = 'necromancy' | 'magic' | 'ranged' | 'melee';

export type AbilityType = 'buff-timer' | 'stacking-buff' | 'ability' | 'enemy-debuff';

export interface AbilityDef {
    id: string;
    name: string;
    shortName: string;
    type: AbilityType;
    source: 'buff' | 'debuff' | 'enemy';
    color: string;
    maxStacks?: number;
    /** Minimum maxStacks without gear modifier (e.g. Residual Souls 3 without Soulbound Lantern) */
    minMaxStacks?: number;
    /** Alternate max stacks when a modifier is active (e.g. Bloodlust 4→8 during Berserk) */
    maxStacksAlt?: number;
    /** Ability ID that triggers the alternate max stacks */
    maxStacksWhen?: string;
    splitAt?: number;
    /** Cooldown duration in seconds (for 'ability' type) */
    cooldownDuration?: number;
    /** When the cooldown starts: 'on-cast' (when buff first appears) or 'on-expiry' (when buff disappears) */
    cooldownStart?: 'on-cast' | 'on-expiry';
    /** Active buff duration in seconds (for display and CD-on-cast calculation) */
    buffDuration?: number;
    /** Hardcoded internal duration in seconds (for 'enemy-debuff' like Bloat) */
    internalDuration?: number;
    /** Reference image filename (without path/extension) */
    refImage?: string;
    /** Alternate reference image for different icon state (e.g. Bloodlust at max stacks) */
    altRefImage?: string;
    /** Mask profile for icon comparison: 'default' or 'dual-text' (masks upper-left timer zone) */
    maskProfile?: 'default' | 'dual-text';
}

/** Visual grouping for gauge layout — how abilities are clustered and rendered */
export interface AbilityGroup {
    id: string;
    name: string;
    /** How this group renders in the gauge:
     *  - 'row': horizontal strip of icons (conjures, stacks)
     *  - 'grid-2x2': 2×2 grid of icons (incantations)
     *  - 'bar': single ability with progress bar (Bloat timer)
     *  - 'prominent': large featured slot (Living Death, Berserk, Sunshine)
     */
    layout: 'row' | 'grid-2x2' | 'bar' | 'prominent';
    /** Ordered list of ability/conjure IDs in this group */
    abilityIds: string[];
}

export interface StyleDef {
    id: CombatStyle;
    name: string;
    icon: string;
    color: string;
    abilities: AbilityDef[];
    /** Visual grouping for gauge layout */
    groups?: AbilityGroup[];
}


// TODO: Wire ability definitions for these registered refs (refs exist in icon-loader, no AbilityDef yet):
// Combat buffs (refs/combat/necromancy/):
//   - 'reaper-necklace': Reaper Necklace — passive stacking buff (needs tracking type decision)
//   - 'life-points-boosted': Life Points Boosted — HP boost indicator (needs tracking type decision)

// --- Necromancy ---
const necromancyAbilities: AbilityDef[] = [
    // ability: buff-bar timer + internal cooldown
    { id: 'living_death', name: 'Living Death', shortName: 'Living Death', type: 'ability', source: 'buff', color: '#c084fc', cooldownDuration: 90, cooldownStart: 'on-expiry', buffDuration: 30, refImage: 'living-death' },
    // TODO: Death Skulls requires action bar cooldown tracking (Phase 6) to function.
    // Currently renders as a permanent placeholder in the gauge.
    // No buff bar icon exists for this ability — cooldown must be read from the action bar.
    { id: 'death_skulls', name: 'Death Skulls', shortName: 'Death Skulls', type: 'ability', source: 'buff', color: '#a78bfa', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 0, refImage: 'death-skulls' },
    { id: 'threads', name: 'Threads of Fate', shortName: 'Threads', type: 'ability', source: 'buff', color: '#a78bfa', cooldownDuration: 45, cooldownStart: 'on-cast', buffDuration: 6.6, refImage: 'threads-of-fate' },
    { id: 'split_soul_necro', name: 'Split Soul', shortName: 'Split Soul', type: 'ability', source: 'buff', color: '#818cf8', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 20.4, refImage: 'split-soul-necro' },
    // buff-timer: screen-read timer from buff bar, no cooldown inference
    { id: 'darkness', name: 'Darkness', shortName: 'Darkness', type: 'buff-timer', source: 'buff', color: '#8b5cf6', refImage: 'darkness' },
    // Tracked but hidden from gauge — consume slots silently
    { id: 'death_spark', name: 'Death Spark', shortName: 'D.Spark', type: 'buff-timer', source: 'buff', color: '#facc15', refImage: 'death-spark' },
    { id: 'death_essence_buff', name: 'Death Essence', shortName: 'D.Essence', type: 'buff-timer', source: 'buff', color: '#a78bfa', refImage: 'death-essence-buff' },
    { id: 'death_essence_debuff', name: 'Death Essence CD', shortName: 'D.Ess CD', type: 'buff-timer', source: 'debuff', color: '#a78bfa', refImage: 'death-essence-debuff' },
    // Slot consumer: matched and consumed but never activates or renders
    { id: 'bone_shield', name: 'Bone Shield', shortName: 'Bone Shield', type: 'buff-timer', source: 'buff', color: '#94a3b8', refImage: 'bone-shield' },
    // stacking-buff: digit reader output is the stack count
    { id: 'souls', name: 'Residual Souls', shortName: 'Souls', type: 'stacking-buff', source: 'buff', color: '#22c55e', maxStacks: 5, minMaxStacks: 3, refImage: 'residual-soul' },
    { id: 'necrosis', name: 'Necrosis', shortName: 'Necrosis', type: 'stacking-buff', source: 'buff', color: '#ef4444', maxStacks: 12, splitAt: 6, refImage: 'necrosis' },
    // enemy-debuff: detected on enemy target display
    { id: 'invoke_death', name: 'Invoke Death', shortName: 'Invoke', type: 'enemy-debuff', source: 'enemy', color: '#f472b6', refImage: 'invoke-death' },
    { id: 'bloat', name: 'Bloat', shortName: 'Bloat', type: 'enemy-debuff', source: 'enemy', color: '#fb923c', internalDuration: 20.5, refImage: 'bloat' },
    // Conjures (buff-timer abilities on the buff bar)
    { id: 'skeleton', name: 'Skeleton Warrior', shortName: 'Skeleton', type: 'buff-timer', source: 'buff', color: '#22c55e', refImage: 'skeleton-warrior', altRefImage: 'skeleton-warrior-raging', maskProfile: 'dual-text' },
    { id: 'zombie', name: 'Putrid Zombie', shortName: 'Zombie', type: 'buff-timer', source: 'buff', color: '#22c55e', refImage: 'putrid-zombie' },
    { id: 'ghost', name: 'Vengeful Ghost', shortName: 'Ghost', type: 'buff-timer', source: 'buff', color: '#22c55e', refImage: 'vengeful-ghost' },
    { id: 'phantom', name: 'Phantom Guardian', shortName: 'Phantom', type: 'buff-timer', source: 'buff', color: '#22c55e', refImage: 'phantom-guardian' },
];


const necromancyGroups: AbilityGroup[] = [
    { id: 'conjures', name: 'Conjures', layout: 'row', abilityIds: ['skeleton', 'zombie', 'ghost', 'phantom'] },
    { id: 'ultimates', name: 'Ultimates', layout: 'prominent', abilityIds: ['living_death', 'death_skulls'] },
    { id: 'incantations', name: 'Incantations', layout: 'grid-2x2', abilityIds: ['invoke_death', 'threads', 'darkness', 'split_soul_necro'] },
    { id: 'residual-souls', name: 'Residual Souls', layout: 'row', abilityIds: ['souls'] },
    { id: 'bloat-timer', name: 'Bloat', layout: 'bar', abilityIds: ['bloat'] },
    { id: 'necrosis-stacks', name: 'Necrosis', layout: 'row', abilityIds: ['necrosis'] },
];

// --- Magic ---
const magicAbilities: AbilityDef[] = [
    { id: 'sunshine', name: 'Sunshine', shortName: 'Sunshine', type: 'ability', source: 'buff', color: '#fbbf24', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 30.6, refImage: 'sunshine' },
    { id: 'greater_sunshine', name: 'Greater Sunshine', shortName: 'G.Sunshine', type: 'ability', source: 'buff', color: '#f59e0b', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 33, refImage: 'greater-sunshine' },
    { id: 'instability', name: 'Instability', shortName: 'Instability', type: 'buff-timer', source: 'buff', color: '#60a5fa', refImage: 'instability' },
    { id: 'tsunami', name: 'Critical Strike', shortName: 'Crit Strike', type: 'buff-timer', source: 'buff', color: '#38bdf8', refImage: 'critical-strike' },
    { id: 'soulfire', name: 'Soulfire', shortName: 'Soulfire', type: 'buff-timer', source: 'debuff', color: '#fb923c', refImage: 'soulfire' },
    { id: 'blood_tithe', name: 'Blood Tithe', shortName: 'Blood Tithe', type: 'buff-timer', source: 'buff', color: '#f87171', refImage: 'blood-tithe' },
    { id: 'glacial_embrace', name: 'Glacial Embrace', shortName: 'Glacial', type: 'buff-timer', source: 'buff', color: '#67e8f9', refImage: 'glacial-embrace' },
    { id: 'animate_dead', name: 'Animate Dead', shortName: 'Anim Dead', type: 'buff-timer', source: 'buff', color: '#a78bfa', refImage: 'animate-dead' },
];

const magicGroups: AbilityGroup[] = [
    { id: 'sunshine-slot', name: 'Sunshine', layout: 'prominent', abilityIds: ['sunshine', 'greater_sunshine'] },
    { id: 'magic-buffs', name: 'Buffs', layout: 'row', abilityIds: ['instability', 'tsunami', 'blood_tithe', 'glacial_embrace'] },
    { id: 'magic-debuffs', name: 'Debuffs', layout: 'row', abilityIds: ['soulfire'] },
    { id: 'magic-sustain', name: 'Sustain', layout: 'row', abilityIds: ['animate_dead'] },
];

// --- Ranged ---
const rangedAbilities: AbilityDef[] = [
    { id: 'deaths_swiftness', name: "Death's Swiftness", shortName: "D.Swift", type: 'ability', source: 'buff', color: '#a3e635', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 30.6, refImage: 'deaths-swiftness' },
    { id: 'greater_deaths_swiftness', name: "Greater Death's Swiftness", shortName: "G.D.Swift", type: 'ability', source: 'buff', color: '#84cc16', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 33, refImage: 'greater-deaths-swiftness' },
    { id: 'crystal_rain', name: 'Crystal Rain', shortName: 'Crystal Rain', type: 'buff-timer', source: 'debuff', color: '#22d3ee', refImage: 'crystal-rain' },
    { id: 'split_soul_ranged', name: 'Split Soul', shortName: 'Split Soul', type: 'buff-timer', source: 'buff', color: '#818cf8', refImage: 'split-soul-ranged' },
    { id: 'perfect_equilibrium', name: 'Perfect Equilibrium', shortName: 'P.Eq', type: 'stacking-buff', source: 'buff', color: '#f472b6', maxStacks: 8, refImage: 'perfect-equilibrium' },
    { id: 'balance_by_force', name: 'Balance by Force', shortName: 'BbF', type: 'buff-timer', source: 'buff', color: '#e879f9', refImage: 'balance-by-force' },
    { id: 'searing_winds', name: 'Searing Winds', shortName: 'Searing', type: 'buff-timer', source: 'buff', color: '#facc15', refImage: 'searing-winds' },
    { id: 'shadow_imbued', name: 'Shadow Imbued', shortName: 'Shadow', type: 'buff-timer', source: 'buff', color: '#6366f1', refImage: 'shadow-imbued' },
];

const rangedGroups: AbilityGroup[] = [
    { id: 'deaths-swiftness-slot', name: "Death's Swiftness", layout: 'prominent', abilityIds: ['deaths_swiftness', 'greater_deaths_swiftness'] },
    { id: 'ranged-buffs', name: 'Buffs', layout: 'row', abilityIds: ['crystal_rain', 'split_soul_ranged', 'balance_by_force', 'searing_winds', 'shadow_imbued'] },
    { id: 'perfect-eq', name: 'Perfect Equilibrium', layout: 'row', abilityIds: ['perfect_equilibrium'] },
];

// --- Melee ---
const meleeAbilities: AbilityDef[] = [
    { id: 'berserk', name: 'Berserk', shortName: 'Berserk', type: 'ability', source: 'buff', color: '#ef4444', cooldownDuration: 60, cooldownStart: 'on-cast', buffDuration: 20.4, refImage: 'berserk' },
    { id: 'greater_barge', name: 'Greater Barge', shortName: 'G.Barge', type: 'buff-timer', source: 'buff', color: '#f97316', refImage: 'greater-barge' },
    { id: 'natural_instinct', name: 'Natural Instinct', shortName: 'Nat Inst', type: 'buff-timer', source: 'buff', color: '#fbbf24', refImage: 'natural-instinct' },
    { id: 'slaughter', name: 'Slaughter', shortName: 'Slaughter', type: 'buff-timer', source: 'buff', color: '#dc2626', refImage: 'slaughter' },
    { id: 'assault', name: 'Assault', shortName: 'Assault', type: 'buff-timer', source: 'buff', color: '#b91c1c', refImage: 'assault' },
    { id: 'destroy', name: 'Destroy', shortName: 'Destroy', type: 'buff-timer', source: 'buff', color: '#991b1b', refImage: 'destroy' },
    { id: 'chaos_roar', name: 'Chaos Roar', shortName: 'C.Roar', type: 'buff-timer', source: 'buff', color: '#fb923c', refImage: 'chaos-roar' },
    { id: 'pulverise', name: 'Pulverise', shortName: 'Pulverise', type: 'buff-timer', source: 'buff', color: '#ea580c', refImage: 'pulverise' },
    { id: 'bloodlust', name: 'Bloodlust', shortName: 'Bloodlust', type: 'stacking-buff', source: 'buff', color: '#b91c1c', maxStacks: 4, maxStacksAlt: 8, maxStacksWhen: 'berserk', refImage: 'bloodlust', altRefImage: 'bloodlust-max' },
];

const meleeGroups: AbilityGroup[] = [
    { id: 'berserk-slot', name: 'Berserk', layout: 'prominent', abilityIds: ['berserk'] },
    { id: 'melee-buffs', name: 'Buffs', layout: 'row', abilityIds: ['greater_barge', 'natural_instinct'] },
    { id: 'melee-bleeds', name: 'Bleeds & Channels', layout: 'row', abilityIds: ['slaughter', 'assault', 'destroy', 'chaos_roar', 'pulverise'] },
    { id: 'bloodlust-stacks', name: 'Bloodlust', layout: 'row', abilityIds: ['bloodlust'] },
];

// --- Style Registry ---
export const COMBAT_STYLES: StyleDef[] = [
    {
        id: 'necromancy',
        name: 'Necromancy',
        icon: '☠',
        color: '#a78bfa',
        abilities: necromancyAbilities,
        groups: necromancyGroups,
    },
    {
        id: 'magic',
        name: 'Magic',
        icon: '✦',
        color: '#fbbf24',
        abilities: magicAbilities,
        groups: magicGroups,
    },
    {
        id: 'ranged',
        name: 'Ranged',
        icon: '➶',
        color: '#a3e635',
        abilities: rangedAbilities,
        groups: rangedGroups,
    },
    {
        id: 'melee',
        name: 'Melee',
        icon: '⚔',
        color: '#ef4444',
        abilities: meleeAbilities,
        groups: meleeGroups,
    },
];

/**
 * Get a style definition by ID.
 */
export function getStyleDef(style: CombatStyle): StyleDef | undefined {
    return COMBAT_STYLES.find(s => s.id === style);
}

/**
 * Get all ability IDs across all styles.
 */
export function getAllAbilityIds(): string[] {
    return COMBAT_STYLES.flatMap(s => s.abilities.map(a => a.id));
}

/** Timer-display types: buff-timer and ability both render as countdowns in the gauge */
export function isTimerDisplay(type: AbilityType): boolean {
    return type === 'buff-timer' || type === 'ability';
}

/** Stacking types: display a stack count instead of a timer */
export function isStackingDisplay(type: AbilityType): boolean {
    return type === 'stacking-buff';
}

/**
 * Get the effective max stacks for an ability, accounting for dynamic modifiers
 * and settings (e.g. Soulbound Lantern toggle).
 */
export function getEffectiveMaxStacks(
    ability: AbilityDef,
    abilities: Record<string, { active: boolean }>,
    settings?: { noSoulboundLantern?: boolean },
): number {
    // Check dynamic modifier (Bloodlust 4→8 during Berserk)
    if (ability.maxStacksAlt && ability.maxStacksWhen) {
        const modifier = abilities[ability.maxStacksWhen];
        if (modifier?.active) {
            return ability.maxStacksAlt;
        }
    }
    // Check Soulbound Lantern setting (Residual Souls 5→3)
    if (settings?.noSoulboundLantern && ability.minMaxStacks) {
        return ability.minMaxStacks;
    }
    return ability.maxStacks || 1;
}
