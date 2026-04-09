# RS3 BuffTracker — Alt1 Plugin

A combat buff/debuff tracker overlay for RuneScape 3, built for [Alt1 Toolkit](https://runeapps.org).

Tracks necromancy abilities, conjures, incantations, stacking buffs, enemy debuffs, and cooldowns with a customizable gauge overlay — no reliance on Alt1's broken BuffReader.

![Status](https://img.shields.io/badge/status-alpha-orange)

---

## Features

- **Custom detection engine** — fully independent of Alt1's BuffReader. Works with the current RS3 UI (post-January 2026 font changes)
- **Scale-aware** — detects buff bar at any RS3 UI scale, not locked to 100%
- **Necromancy tracking** — conjures, Living Death, Darkness, Split Soul, Threads of Fate, Invoke Death, Bloat, Residual Souls, Necrosis stacks, Death Spark, Death Essence
- **Enemy debuff tracking** — reads the target's debuff bar for Bloat, Invoke Death, Haunted
- **Multiple gauge styles** — Compact, Classic, Modern, Themed, Frames
- **Custom timer reading** — built-in digit recognition, no Alt1 OCR dependency
- **Configurable alerts** — buff expiry warnings, stack thresholds, timer alerts
- **Cross-hardware compatible** — reference images are sRGB-stripped at build time via Alt1's imagedata-loader for consistent matching on any system

## Requirements

- [Alt1 Toolkit](https://runeapps.org) installed
- RuneScape 3 (NXT client)
- Buff bar icon size: **Small** (in RS3 Settings → Interfaces → Buff Bar)
- Game and UI Scale: **100%** recommended (other scales supported but less tested)

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

*Additional combat styles (Magic, Ranged, Melee) have reference images included but are not yet wired for active tracking.*

## Settings

- **Gauge style** — choose from 5 overlay styles
- **Ability toggles** — show/hide individual abilities from the gauge
- **Position & scale** — nudge buttons and scale slider (50-200%)
- **Alert thresholds** — configure when expiry/stack warnings trigger
- **Developer Settings** — debug logging, session recording, log export (hidden by default)

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
