# RS3 BuffTracker — Alt1 Plugin

A combat buff/debuff tracker overlay for RuneScape 3, built for [Alt1 Toolkit](https://runeapps.org).

Tracks necromancy abilities, conjures, incantations, stacking buffs, enemy debuffs, and cooldowns with a customizable gauge overlay 

![Status](https://img.shields.io/badge/status-alpha-orange)

---

## Features

- **Works with the current RS3 UI (post-January 2026 font changes)**
- **Scale-aware (In-progress)** — Should currently function at 100, 120, 150, 200 - may require additional testing.
- **Necromancy tracking** — conjures, Living Death, Darkness, Split Soul, Threads of Fate, Invoke Death, Bloat, Residual Souls, Necrosis stacks, Death Spark, Death Essence
- **Enemy debuff tracking** — reads the target's debuff bar for Bloat, Invoke Death, Haunted
- **Five gauge styles** — Compact (A), Classic (B), Modern (C), Themed (D), Themed Frames (E)
- **Custom timer reading** — built-in digit recognition
- **Configurable alerts** — buff expiry warnings, stack thresholds, timer alerts

## Requirements

- [Alt1 Toolkit](https://runeapps.org) installed
- RuneScape 3 (NXT client)
- Buff bar icon size: **Small** (in RS3 Settings → Interfaces → Buff Bar)
- Game and UI Scale: **100% recommended.** Other scales work too — the detector handles roughly 60% to 260% of default. If detection won't find your buff bar, try changing your RS3 in-game UI Settings → Display → Interface Scale and click Detect again.

## Installation

Paste this link into Alt1's browser:

```
alt1://addapp/https://xfear-the-beard.github.io/RS3-BuffTracker-Alt1/appconfig.json
```

Or open the URL in Alt1's built-in browser and click "Add App".

## Setup

1. Open the plugin in Alt1
2. Click **Detect Buff Bar** — move your mouse over your buff bar until the green border highlights, then click to anchor
3. Click **Detect Debuff Bar** — same process for your player debuff bar
4. Click **Detect Enemy Debuff Bar** — target an enemy first, then hover over their debuff bar and click (optional — only needed if you want to track Bloat, Invoke Death, etc. on your target)
5. The gauge overlay appears and begins tracking automatically

Detection positions are saved between sessions. You only need to re-detect if you move your interface layout.

## How It Works

The plugin reads your buff bar using Alt1's screen capture and matches each icon slot against a library of known ability icons. Timers and stack counts are read directly from the icon text using a built-in digit reader — no dependency on Alt1's OCR or BuffReader.

It works with the current RS3 interface (post-January 2026 UI update) and handles the aliased font changes that broke most existing buff tracking plugins.

## Tracked Abilities

### Necromancy
| Category | Abilities |
|----------|-----------|
| Conjures | Skeleton Warrior (with rage stacks), Putrid Zombie, Vengeful Ghost, Phantom Guardian |
| Ultimates | Living Death |
| Incantations | Darkness, Threads of Fate, Split Soul, Invoke Death |
| Stacking | Residual Souls (3 or 5 max), Necrosis (0-12 in pairs) |
| Weapon | Death Spark, Death Essence (buff + cooldown) |
| Enemy Debuffs | Bloat, Invoke Death, Haunted |
| Excluded | Bone Shield (consumed silently to prevent false matches) |

### Magic, Ranged, Melee
Magic, Ranged, and Melee abilities are defined and tracked at the data layer (Sunshine, Death's Swiftness, Berserk, Bloodlust, Perfect Equilibrium, etc.), but the gauges currently render them with a generic layout instead of style-specific visuals. Necromancy gets dedicated treatment (soul orbs, conjure pills, prominent ultimates) because that's what was built out first. Style-specific layouts for Magic, Ranged, and Melee are planned — see the Roadmap section below.

## Settings

- **Gauge style** — choose from 5 overlay styles
- **Ability toggles** — show/hide individual abilities from the gauge
- **Position & scale** — nudge buttons and scale slider (50-200%)
- **Alert thresholds** — configure when expiry/stack warnings trigger
- **Developer Settings** — debug logging, session recording, log export (hidden by default)

## Roadmap

- Style-specific gauge layouts for Magic, Ranged, and Melee — currently they share a generic layout while Necromancy gets dedicated visuals. Each style needs its own treatment for ultimates, channel sequences, and stack counters (Berserk + Bloodlust, Death's Swiftness + Perfect Equilibrium, Sunshine + soul fragments, etc.).
- Skilling tracker panel — a third overlay panel for skilling buffs (XP boosts, gathering bonuses, prayer renewals outside combat). Reference images are already collected; UI work is pending.
- Combat Buffs panel — a checklist mode for tracking always-on potions, scriptures, auras, and prayer renewal that should always be active during combat.
- Death Skulls cooldown tracking — needs action bar reading rather than buff bar matching.
- Color tolerance auto-calibration — the current border detection uses a fixed RGB tolerance that may be tight for monitors with non-standard gamma or color profiles. Auto-calibration on first detection would make this more forgiving.

## Building from Source

```bash
npm install
npm run build
```

Output goes to `dist/`. Requires Node.js and the `alt1` npm package.

## Credits

- Game mechanics reference: [RuneScape Wiki](https://runescape.wiki), [PvM Encyclopedia](https://pvme.io)
- Inspired by [Job Gauges](https://github.com/NadyaNayme/job-gauges) by NadyaNayme

## Disclaimer

This is an unofficial third-party tool. It reads screen pixels only — no game memory access, no automation, no client modification. Use at your own discretion.

## License

MIT
