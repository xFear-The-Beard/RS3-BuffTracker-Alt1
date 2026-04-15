/**
 * Reference image loader for buff icon matching.
 *
 * Detection refs use Alt1's imagedata-loader (.data.png) which strips sRGB
 * metadata at webpack build time, producing byte-identical pixel values
 * across all machines regardless of OS/browser color profile.
 *
 * Display refs (.png) are loaded at runtime via fetch as HTMLImageElement
 * for gauge rendering only - they are NOT used for detection.
 */

import { debugLog } from '../lib/debug';

/**
 * Detection ref images - loaded via imagedata-loader at build time.
 * Each require() returns a Promise<ImageData> with sRGB-stripped pixels.
 */
const REF_PROMISES: Record<string, Promise<ImageData>> = {
    // Combat - Necromancy
    'living-death': require('../refs/combat/necromancy/living-death.data.png'),
    'darkness': require('../refs/combat/necromancy/darkness.data.png'),
    'threads-of-fate': require('../refs/combat/necromancy/threads-of-fate.data.png'),
    'split-soul-necro': require('../refs/combat/necromancy/split-soul-necro.data.png'),
    'residual-soul': require('../refs/combat/necromancy/residual-soul.data.png'),
    'necrosis': require('../refs/combat/necromancy/necrosis.data.png'),
    'invoke-death': require('../refs/combat/necromancy/invoke-death.data.png'),
    'bloat': require('../refs/combat/necromancy/bloat.data.png'),
    'skeleton-warrior': require('../refs/combat/necromancy/skeleton-warrior.data.png'),
    'skeleton-warrior-raging': require('../refs/combat/necromancy/skeleton-warrior-raging.data.png'),
    'putrid-zombie': require('../refs/combat/necromancy/putrid-zombie.data.png'),
    'vengeful-ghost': require('../refs/combat/necromancy/vengeful-ghost.data.png'),
    'phantom-guardian': require('../refs/combat/necromancy/phantom-guardian.data.png'),
    'death-spark': require('../refs/combat/necromancy/death-spark.data.png'),
    'death-essence-buff': require('../refs/combat/necromancy/death-essence-buff.data.png'),
    'death-spark-inactive': require('../refs/combat/necromancy/death-spark-inactive.data.png'),
    'bone-shield': require('../refs/combat/necromancy/bone-shield.data.png'),
    'reaper-necklace': require('../refs/combat/necromancy/reaper-necklace.data.png'),
    'life-points-boosted': require('../refs/combat/necromancy/life-points-boosted.data.png'),
    // Combat - Enemy Debuffs
    'haunted-ghost': require('../refs/combat/enemy/haunted-ghost.data.png'),
    'invoke-death-enemy': require('../refs/combat/enemy/invoke-death-enemy.data.png'),
    // Combat - Player Debuff Cooldowns
    'death-essence-debuff': require('../refs/combat/debuffs/death-essence-debuff.data.png'),
    'death-grasp': require('../refs/combat/debuffs/death-grasp.data.png'),
    'crackling-debuff': require('../refs/combat/debuffs/crackling-debuff.data.png'),
    // Combat - Magic
    'sunshine': require('../refs/combat/magic/sunshine.data.png'),
    'greater-sunshine': require('../refs/combat/magic/greater-sunshine.data.png'),
    'instability': require('../refs/combat/magic/instability.data.png'),
    'critical-strike': require('../refs/combat/magic/critical-strike.data.png'),
    'blood-tithe': require('../refs/combat/magic/blood-tithe.data.png'),
    'glacial-embrace': require('../refs/combat/magic/glacial-embrace.data.png'),
    'soulfire': require('../refs/combat/magic/soulfire.data.png'),
    'animate-dead': require('../refs/combat/magic/animate-dead.data.png'),
    // Combat - Ranged
    'deaths-swiftness': require('../refs/combat/ranged/deaths-swiftness.data.png'),
    'greater-deaths-swiftness': require('../refs/combat/ranged/greater-deaths-swiftness.data.png'),
    'crystal-rain': require('../refs/combat/ranged/crystal-rain.data.png'),
    'split-soul-ranged': require('../refs/combat/ranged/split-soul-ranged.data.png'),
    'perfect-equilibrium': require('../refs/combat/ranged/perfect-equilibrium.data.png'),
    'balance-by-force': require('../refs/combat/ranged/balance-by-force.data.png'),
    'searing-winds': require('../refs/combat/ranged/searing-winds.data.png'),
    'shadow-imbued': require('../refs/combat/ranged/shadow-imbued.data.png'),
    // Combat - Melee
    'berserk': require('../refs/combat/melee/berserk.data.png'),
    'greater-barge': require('../refs/combat/melee/greater-barge.data.png'),
    'natural-instinct': require('../refs/combat/melee/natural-instinct.data.png'),
    'slaughter': require('../refs/combat/melee/slaughter.data.png'),
    'assault': require('../refs/combat/melee/assault.data.png'),
    'destroy': require('../refs/combat/melee/destroy.data.png'),
    'chaos-roar': require('../refs/combat/melee/chaos-roar.data.png'),
    'pulverise': require('../refs/combat/melee/pulverise.data.png'),
    'bloodlust': require('../refs/combat/melee/bloodlust.data.png'),
    'bloodlust-max': require('../refs/combat/melee/bloodlust-max.data.png'),
    // Combat - General
    'overload': require('../refs/combat/general/overload.data.png'),
    'elder-overload': require('../refs/combat/general/elder-overload.data.png'),
    'supreme-overload': require('../refs/combat/general/supreme-overload.data.png'),
    'supreme-overload-salve': require('../refs/combat/general/supreme-overload-salve.data.png'),
    'weapon-poison': require('../refs/combat/general/weapon-poison.data.png'),
    'prayer-renewal': require('../refs/combat/general/prayer-renewal.data.png'),
    'super-prayer-renewal': require('../refs/combat/general/super-prayer-renewal.data.png'),
    'adrenaline-renewal': require('../refs/combat/general/adrenaline-renewal.data.png'),
    'antifire': require('../refs/combat/general/antifire.data.png'),
    'wyrmfire': require('../refs/combat/general/wyrmfire.data.png'),
    'aggression-potion': require('../refs/combat/general/aggression-potion.data.png'),
    // Combat - Defensive
    'devotion': require('../refs/combat/defensive/devotion.data.png'),
    'barricade': require('../refs/combat/defensive/barricade.data.png'),
    'reflect': require('../refs/combat/defensive/reflect.data.png'),
    'debilitate': require('../refs/combat/defensive/debilitate.data.png'),
    'resonance': require('../refs/combat/defensive/resonance.data.png'),
    'anticipation': require('../refs/combat/defensive/anticipation.data.png'),
    'freedom': require('../refs/combat/defensive/freedom.data.png'),
    'immortality': require('../refs/combat/defensive/immortality.data.png'),
    'divert': require('../refs/combat/defensive/divert.data.png'),
    'disruption-shield': require('../refs/combat/defensive/disruption-shield.data.png'),
    // Combat - Utility
    'vulnerability': require('../refs/combat/utility/vulnerability.data.png'),
    'smoke-cloud': require('../refs/combat/utility/smoke-cloud.data.png'),
    'limitless': require('../refs/combat/utility/limitless.data.png'),
    'ingenuity': require('../refs/combat/utility/ingenuity.data.png'),
    'onslaught': require('../refs/combat/utility/onslaught.data.png'),
    // Combat - Sigils
    'demon-slayer': require('../refs/combat/sigils/demon-slayer.data.png'),
    'dragon-slayer': require('../refs/combat/sigils/dragon-slayer.data.png'),
    'undead-slayer': require('../refs/combat/sigils/undead-slayer.data.png'),
    // Combat - Weapon Specs
    'grimoire': require('../refs/combat/weapon-specs/grimoire.data.png'),
    'scripture-jas': require('../refs/combat/weapon-specs/scripture-jas.data.png'),
    'scripture-ful': require('../refs/combat/weapon-specs/scripture-ful.data.png'),
    'scripture-wen': require('../refs/combat/weapon-specs/scripture-wen.data.png'),
    'excalibur-cooldown': require('../refs/combat/weapon-specs/excalibur-cooldown.data.png'),
    'sign-of-life-cooldown': require('../refs/combat/weapon-specs/sign-of-life-cooldown.data.png'),
    'elven-shard-cooldown': require('../refs/combat/weapon-specs/elven-shard-cooldown.data.png'),
    'adren-pot-cooldown': require('../refs/combat/weapon-specs/adren-pot-cooldown.data.png'),
    'powerburst-cooldown': require('../refs/combat/weapon-specs/powerburst-cooldown.data.png'),
    'portent-cooldown': require('../refs/combat/weapon-specs/portent-cooldown.data.png'),
    // Combat - Prayers
    'soul-split': require('../refs/combat/prayers/soul-split.data.png'),
    'deflect-magic': require('../refs/combat/prayers/deflect-magic.data.png'),
    'deflect-melee': require('../refs/combat/prayers/deflect-melee.data.png'),
    'deflect-ranged': require('../refs/combat/prayers/deflect-ranged.data.png'),
    'deflect-necromancy': require('../refs/combat/prayers/deflect-necromancy.data.png'),
    'affliction': require('../refs/combat/prayers/affliction.data.png'),
    'anguish': require('../refs/combat/prayers/anguish.data.png'),
    'desolation': require('../refs/combat/prayers/desolation.data.png'),
    'malevolence': require('../refs/combat/prayers/malevolence.data.png'),
    'ruination': require('../refs/combat/prayers/ruination.data.png'),
    'torment': require('../refs/combat/prayers/torment.data.png'),
    'turmoil': require('../refs/combat/prayers/turmoil.data.png'),
    'sorrow': require('../refs/combat/prayers/sorrow.data.png'),
    // Combat - Invention
    'crackling': require('../refs/combat/invention/crackling.data.png'),
    'crackling-cooldown': require('../refs/combat/invention/crackling-cooldown.data.png'),
    'aftershock': require('../refs/combat/invention/aftershock.data.png'),
    'enhanced-devoted': require('../refs/combat/invention/enhanced-devoted.data.png'),
    'relentless': require('../refs/combat/invention/relentless.data.png'),
    'ruthless': require('../refs/combat/invention/ruthless.data.png'),
    // Combat - Incense
    'incense-lantadyme': require('../refs/combat/incense/incense-lantadyme.data.png'),
    'incense-kwuarm': require('../refs/combat/incense/incense-kwuarm.data.png'),
    'incense-dwarf-weed': require('../refs/combat/incense/incense-dwarf-weed.data.png'),
    'incense-spirit-weed': require('../refs/combat/incense/incense-spirit-weed.data.png'),
    'incense-fellstalk': require('../refs/combat/incense/incense-fellstalk.data.png'),
    'incense-torstol': require('../refs/combat/incense/incense-torstol.data.png'),
};

/**
 * Display image paths - for gauge rendering only, loaded at runtime via fetch.
 * These are plain .png files in dist/refs/, NOT processed by imagedata-loader.
 */
const DISPLAY_IMAGE_PATHS: Record<string, string> = {
    'living-death': 'refs/combat/necromancy/living-death.png',
    'death-skulls': 'refs/combat/necromancy/death-skulls.png',
    'darkness': 'refs/combat/necromancy/darkness.png',
    'threads-of-fate': 'refs/combat/necromancy/threads-of-fate.png',
    'split-soul-necro': 'refs/combat/necromancy/split-soul-necro.png',
    'residual-soul': 'refs/combat/necromancy/residual-soul.png',
    'necrosis': 'refs/combat/necromancy/necrosis.png',
    'invoke-death': 'refs/combat/necromancy/invoke-death.png',
    'bloat': 'refs/combat/necromancy/bloat.png',
    'skeleton-warrior': 'refs/combat/necromancy/skeleton-warrior.png',
    'skeleton-warrior-raging': 'refs/combat/necromancy/skeleton-warrior-raging.png',
    'putrid-zombie': 'refs/combat/necromancy/putrid-zombie.png',
    'vengeful-ghost': 'refs/combat/necromancy/vengeful-ghost.png',
    'phantom-guardian': 'refs/combat/necromancy/phantom-guardian.png',
    'death-spark': 'refs/combat/necromancy/death-spark.png',
    'death-essence-buff': 'refs/combat/necromancy/death-essence-buff.png',
    'death-spark-inactive': 'refs/combat/necromancy/death-spark-inactive.png',
    'bone-shield': 'refs/combat/necromancy/bone-shield.png',
    'reaper-necklace': 'refs/combat/necromancy/reaper-necklace.png',
    'life-points-boosted': 'refs/combat/necromancy/life-points-boosted.png',
    'haunted-ghost': 'refs/combat/enemy/haunted-ghost.png',
    'invoke-death-enemy': 'refs/combat/enemy/invoke-death-enemy.png',
    'death-essence-debuff': 'refs/combat/debuffs/death-essence-debuff.png',
    'death-grasp': 'refs/combat/debuffs/death-grasp.png',
    'crackling-debuff': 'refs/combat/debuffs/crackling-debuff.png',
    'sunshine': 'refs/combat/magic/sunshine.png',
    'greater-sunshine': 'refs/combat/magic/greater-sunshine.png',
    'instability': 'refs/combat/magic/instability.png',
    'critical-strike': 'refs/combat/magic/critical-strike.png',
    'blood-tithe': 'refs/combat/magic/blood-tithe.png',
    'glacial-embrace': 'refs/combat/magic/glacial-embrace.png',
    'soulfire': 'refs/combat/magic/soulfire.png',
    'animate-dead': 'refs/combat/magic/animate-dead.png',
    'deaths-swiftness': 'refs/combat/ranged/deaths-swiftness.png',
    'greater-deaths-swiftness': 'refs/combat/ranged/greater-deaths-swiftness.png',
    'crystal-rain': 'refs/combat/ranged/crystal-rain.png',
    'split-soul-ranged': 'refs/combat/ranged/split-soul-ranged.png',
    'perfect-equilibrium': 'refs/combat/ranged/perfect-equilibrium.png',
    'balance-by-force': 'refs/combat/ranged/balance-by-force.png',
    'searing-winds': 'refs/combat/ranged/searing-winds.png',
    'shadow-imbued': 'refs/combat/ranged/shadow-imbued.png',
    'berserk': 'refs/combat/melee/berserk.png',
    'greater-barge': 'refs/combat/melee/greater-barge.png',
    'natural-instinct': 'refs/combat/melee/natural-instinct.png',
    'slaughter': 'refs/combat/melee/slaughter.png',
    'assault': 'refs/combat/melee/assault.png',
    'destroy': 'refs/combat/melee/destroy.png',
    'chaos-roar': 'refs/combat/melee/chaos-roar.png',
    'pulverise': 'refs/combat/melee/pulverise.png',
    'bloodlust': 'refs/combat/melee/bloodlust.png',
    'bloodlust-max': 'refs/combat/melee/bloodlust-max.png',
    'overload': 'refs/combat/general/overload.png',
    'elder-overload': 'refs/combat/general/elder-overload.png',
    'supreme-overload': 'refs/combat/general/supreme-overload.png',
    'supreme-overload-salve': 'refs/combat/general/supreme-overload-salve.png',
    'weapon-poison': 'refs/combat/general/weapon-poison.png',
    'prayer-renewal': 'refs/combat/general/prayer-renewal.png',
    'super-prayer-renewal': 'refs/combat/general/super-prayer-renewal.png',
    'adrenaline-renewal': 'refs/combat/general/adrenaline-renewal.png',
    'antifire': 'refs/combat/general/antifire.png',
    'wyrmfire': 'refs/combat/general/wyrmfire.png',
    'aggression-potion': 'refs/combat/general/aggression-potion.png',
    'devotion': 'refs/combat/defensive/devotion.png',
    'barricade': 'refs/combat/defensive/barricade.png',
    'reflect': 'refs/combat/defensive/reflect.png',
    'debilitate': 'refs/combat/defensive/debilitate.png',
    'resonance': 'refs/combat/defensive/resonance.png',
    'anticipation': 'refs/combat/defensive/anticipation.png',
    'freedom': 'refs/combat/defensive/freedom.png',
    'immortality': 'refs/combat/defensive/immortality.png',
    'divert': 'refs/combat/defensive/divert.png',
    'disruption-shield': 'refs/combat/defensive/disruption-shield.png',
    'vulnerability': 'refs/combat/utility/vulnerability.png',
    'smoke-cloud': 'refs/combat/utility/smoke-cloud.png',
    'limitless': 'refs/combat/utility/limitless.png',
    'ingenuity': 'refs/combat/utility/ingenuity.png',
    'onslaught': 'refs/combat/utility/onslaught.png',
    'demon-slayer': 'refs/combat/sigils/demon-slayer.png',
    'dragon-slayer': 'refs/combat/sigils/dragon-slayer.png',
    'undead-slayer': 'refs/combat/sigils/undead-slayer.png',
    'grimoire': 'refs/combat/weapon-specs/grimoire.png',
    'scripture-jas': 'refs/combat/weapon-specs/scripture-jas.png',
    'scripture-ful': 'refs/combat/weapon-specs/scripture-ful.png',
    'scripture-wen': 'refs/combat/weapon-specs/scripture-wen.png',
    'excalibur-cooldown': 'refs/combat/weapon-specs/excalibur-cooldown.png',
    'sign-of-life-cooldown': 'refs/combat/weapon-specs/sign-of-life-cooldown.png',
    'elven-shard-cooldown': 'refs/combat/weapon-specs/elven-shard-cooldown.png',
    'adren-pot-cooldown': 'refs/combat/weapon-specs/adren-pot-cooldown.png',
    'powerburst-cooldown': 'refs/combat/weapon-specs/powerburst-cooldown.png',
    'portent-cooldown': 'refs/combat/weapon-specs/portent-cooldown.png',
    'soul-split': 'refs/combat/prayers/soul-split.png',
    'deflect-magic': 'refs/combat/prayers/deflect-magic.png',
    'deflect-melee': 'refs/combat/prayers/deflect-melee.png',
    'deflect-ranged': 'refs/combat/prayers/deflect-ranged.png',
    'deflect-necromancy': 'refs/combat/prayers/deflect-necromancy.png',
    'affliction': 'refs/combat/prayers/affliction.png',
    'anguish': 'refs/combat/prayers/anguish.png',
    'desolation': 'refs/combat/prayers/desolation.png',
    'malevolence': 'refs/combat/prayers/malevolence.png',
    'ruination': 'refs/combat/prayers/ruination.png',
    'torment': 'refs/combat/prayers/torment.png',
    'turmoil': 'refs/combat/prayers/turmoil.png',
    'sorrow': 'refs/combat/prayers/sorrow.png',
    'crackling': 'refs/combat/invention/crackling.png',
    'crackling-cooldown': 'refs/combat/invention/crackling-cooldown.png',
    'aftershock': 'refs/combat/invention/aftershock.png',
    'enhanced-devoted': 'refs/combat/invention/enhanced-devoted.png',
    'relentless': 'refs/combat/invention/relentless.png',
    'ruthless': 'refs/combat/invention/ruthless.png',
    'incense-lantadyme': 'refs/combat/incense/incense-lantadyme.png',
    'incense-kwuarm': 'refs/combat/incense/incense-kwuarm.png',
    'incense-dwarf-weed': 'refs/combat/incense/incense-dwarf-weed.png',
    'incense-spirit-weed': 'refs/combat/incense/incense-spirit-weed.png',
    'incense-fellstalk': 'refs/combat/incense/incense-fellstalk.png',
    'incense-torstol': 'refs/combat/incense/incense-torstol.png',
};

/** Resolved detection refs - populated by loadAllRefImages() */
let allImages: Record<string, ImageData> = {};

/** Loaded display images for RENDERING - clean wiki icons without timer text */
let displayImages: Record<string, HTMLImageElement> = {};

/** Custom indicator images (soul ghost, necrosis skull) */
let indicatorImages: Record<string, HTMLImageElement> = {};

/** Get custom indicator images for stack displays */
export function getIndicatorImages(): Record<string, HTMLImageElement> {
    return indicatorImages;
}

/**
 * Get the loaded reference images map (for detection/matching).
 * Returns pre-resolved ImageData from imagedata-loader.
 */
export function getRefImages(): Record<string, ImageData> {
    return allImages;
}

/**
 * Get the loaded display images map (clean icons for gauge rendering).
 */
export function getDisplayImages(): Record<string, HTMLImageElement> {
    return displayImages;
}

/**
 * Load a PNG as an HTMLImageElement for rendering.
 */
async function loadPngAsImage(url: string): Promise<HTMLImageElement | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        return img;
    } catch {
        return null;
    }
}

/**
 * Load all reference and display images.
 * Detection refs are resolved from imagedata-loader Promises (sRGB-stripped at build time).
 * Display refs are loaded at runtime via fetch as HTMLImageElement.
 */
export async function loadAllRefImages(): Promise<void> {
    // Resolve detection refs from imagedata-loader Promises
    const entries = Object.entries(REF_PROMISES);
    let loaded = 0;
    let failed = 0;

    const refResults = await Promise.all(entries.map(async ([id, promise]) => {
        try {
            const img = await promise;
            return { id, img };
        } catch (e) {
            console.warn(`[IconLoader] Failed to resolve ref: ${id}`, e);
            return { id, img: null };
        }
    }));

    for (const { id, img } of refResults) {
        if (img && img.width > 0 && img.height > 0) {
            allImages[id] = img;
            loaded++;
        } else {
            failed++;
            console.warn(`[IconLoader] Invalid ref: ${id} (${img ? `${img.width}x${img.height}` : 'null'})`);
        }
    }

    debugLog(`[IconLoader] Loaded ${loaded} detection refs via imagedata-loader (${failed} failed)`);

    // Log verification for first few refs
    const sampleIds = Object.keys(allImages).slice(0, 3);
    for (const id of sampleIds) {
        const img = allImages[id];
        const d = img.data;
        debugLog(`[IconLoader] Ref[${id}] ${img.width}x${img.height} px(0,0)=R${d[0]}G${d[1]}B${d[2]}A${d[3]} px(1,0)=R${d[4]}G${d[5]}B${d[6]}A${d[7]}`);
    }

    // Load display images for gauge rendering
    let displayLoaded = 0;
    const displayPromises = Object.entries(DISPLAY_IMAGE_PATHS).map(async ([id, refPath]) => {
        const displayPath = refPath.replace('refs/combat/', 'refs/display/');
        let img = await loadPngAsImage(displayPath);
        if (!img) {
            img = await loadPngAsImage(refPath);
        }
        if (img) {
            displayImages[id] = img;
            displayLoaded++;
        }
    });
    await Promise.all(displayPromises);
    debugLog(`[IconLoader] Loaded ${displayLoaded} display images`);

    // Load custom indicator images
    const indicatorPaths: Record<string, string> = {
        'soul': 'refs/indicators/soul-indicator.png',
        'necrosis': 'refs/indicators/necrosis-indicator.png',
    };
    for (const [id, indicatorPath] of Object.entries(indicatorPaths)) {
        const img = await loadPngAsImage(indicatorPath);
        if (img) {
            indicatorImages[id] = img;
            debugLog(`[IconLoader] Loaded indicator: ${id}`);
        }
    }
}
