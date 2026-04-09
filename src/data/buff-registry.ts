/**
 * Combat buff registry for the Settings panel.
 * Organizes all trackable buffs by category with display names and tier info.
 * Derived from the icon registry (_icon_registry.json).
 */

import { BuffTrackMode } from '../ui/store';

export interface BuffDef {
    id: string;
    name: string;
}

export interface BuffCategory {
    id: string;
    label: string;
    tier: number;
    defaultMode: BuffTrackMode;
    collapsed: boolean;
    buffs: BuffDef[];
}

/**
 * Human-readable names for buff IDs.
 */
const BUFF_NAMES: Record<string, string> = {
    // General Combat (Tier 1)
    'overload': 'Overload',
    'elder-overload': 'Elder Overload',
    'supreme-overload': 'Supreme Overload',
    'supreme-overload-salve': 'Supreme Overload Salve',
    'weapon-poison': 'Weapon Poison',
    'prayer-renewal': 'Prayer Renewal',
    'super-prayer-renewal': 'Super Prayer Renewal',
    'adrenaline-renewal': 'Adrenaline Renewal',
    'antifire': 'Antifire',
    'wyrmfire': 'Wyrmfire',
    'aggression-potion': 'Aggression Potion',

    // Defensive Abilities (Tier 2)
    'devotion': 'Devotion',
    'barricade': 'Barricade',
    'reflect': 'Reflect',
    'debilitate': 'Debilitate',
    'resonance': 'Resonance',
    'anticipation': 'Anticipation',
    'freedom': 'Freedom',
    'immortality': 'Immortality',
    'divert': 'Divert',
    'disruption-shield': 'Disruption Shield',

    // Utility (Tier 2)
    'vulnerability': 'Vulnerability',
    'smoke-cloud': 'Smoke Cloud',
    'limitless': 'Limitless',
    'ingenuity': 'Ingenuity of the Humans',
    'onslaught': 'Onslaught',

    // Sigils (Tier 2)
    'demon-slayer': 'Demon Slayer Sigil',
    'dragon-slayer': 'Dragon Slayer Sigil',
    'undead-slayer': 'Undead Slayer Sigil',

    // Weapon Specs & Cooldowns (Tier 2)
    'grimoire': 'Grimoire',
    'scripture-jas': 'Scripture of Jas',
    'scripture-ful': 'Scripture of Ful',
    'scripture-wen': 'Scripture of Wen',
    'excalibur-cooldown': 'Excalibur Cooldown',
    'sign-of-life-cooldown': 'Sign of Life Cooldown',
    'elven-shard-cooldown': 'Elven Shard Cooldown',
    'adren-pot-cooldown': 'Adrenaline Pot Cooldown',
    'powerburst-cooldown': 'Powerburst Cooldown',
    'portent-cooldown': 'Portent Cooldown',

    // Prayers (Tier 3)
    'soul-split': 'Soul Split',
    'deflect-magic': 'Deflect Magic',
    'deflect-melee': 'Deflect Melee',
    'deflect-ranged': 'Deflect Ranged',
    'deflect-necromancy': 'Deflect Necromancy',
    'affliction': 'Affliction',
    'anguish': 'Anguish',
    'desolation': 'Desolation',
    'malevolence': 'Malevolence',
    'ruination': 'Ruination',
    'torment': 'Torment',
    'turmoil': 'Turmoil',
    'sorrow': 'Sorrow',

    // Invention Perks (Tier 3)
    'crackling': 'Crackling',
    'crackling-cooldown': 'Crackling Cooldown',
    'aftershock': 'Aftershock',
    'enhanced-devoted': 'Enhanced Devoted',
    'relentless': 'Relentless',
    'ruthless': 'Ruthless',

    // Incense Sticks (Tier 3)
    'incense-lantadyme': 'Lantadyme Incense',
    'incense-kwuarm': 'Kwuarm Incense',
    'incense-dwarf-weed': 'Dwarf Weed Incense',
    'incense-spirit-weed': 'Spirit Weed Incense',
    'incense-fellstalk': 'Fellstalk Incense',
    'incense-torstol': 'Torstol Incense',
};

/**
 * Combat buff categories for the settings panel.
 * Order matters -- this is the display order.
 */
export const COMBAT_BUFF_CATEGORIES: BuffCategory[] = [
    {
        id: 'combat/general',
        label: 'General Combat',
        tier: 1,
        defaultMode: 'track',
        collapsed: false,
        buffs: [
            'overload', 'elder-overload', 'supreme-overload', 'supreme-overload-salve',
            'weapon-poison', 'prayer-renewal', 'super-prayer-renewal',
            'adrenaline-renewal', 'antifire', 'wyrmfire', 'aggression-potion',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/defensive',
        label: 'Defensive Abilities',
        tier: 2,
        defaultMode: 'off',
        collapsed: false,
        buffs: [
            'devotion', 'barricade', 'reflect', 'debilitate', 'resonance',
            'anticipation', 'freedom', 'immortality', 'divert', 'disruption-shield',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/utility',
        label: 'Utility',
        tier: 2,
        defaultMode: 'off',
        collapsed: false,
        buffs: [
            'vulnerability', 'smoke-cloud', 'limitless', 'ingenuity', 'onslaught',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/sigils',
        label: 'Sigils',
        tier: 2,
        defaultMode: 'off',
        collapsed: false,
        buffs: [
            'demon-slayer', 'dragon-slayer', 'undead-slayer',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/weapon-specs',
        label: 'Weapon Specs & Cooldowns',
        tier: 2,
        defaultMode: 'off',
        collapsed: false,
        buffs: [
            'grimoire', 'scripture-jas', 'scripture-ful', 'scripture-wen',
            'excalibur-cooldown', 'sign-of-life-cooldown', 'elven-shard-cooldown',
            'adren-pot-cooldown', 'powerburst-cooldown', 'portent-cooldown',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/prayers',
        label: 'Prayers',
        tier: 3,
        defaultMode: 'off',
        collapsed: true,
        buffs: [
            'soul-split', 'deflect-magic', 'deflect-melee', 'deflect-ranged',
            'deflect-necromancy', 'affliction', 'anguish', 'desolation',
            'malevolence', 'ruination', 'torment', 'turmoil', 'sorrow',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/invention',
        label: 'Invention Perks',
        tier: 3,
        defaultMode: 'off',
        collapsed: true,
        buffs: [
            'crackling', 'crackling-cooldown', 'aftershock',
            'enhanced-devoted', 'relentless', 'ruthless',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
    {
        id: 'combat/incense',
        label: 'Incense Sticks',
        tier: 3,
        defaultMode: 'off',
        collapsed: true,
        buffs: [
            'incense-lantadyme', 'incense-kwuarm', 'incense-dwarf-weed',
            'incense-spirit-weed', 'incense-fellstalk', 'incense-torstol',
        ].map(id => ({ id, name: BUFF_NAMES[id] || id })),
    },
];
