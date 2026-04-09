import { OverlayRenderer, hexToRgba, hexToRgb, formatTimeShort, roundRect } from '../renderer';
import { AppState, AbilityState } from '../store';
import { StyleDef, AbilityDef, AbilityGroup, isTimerDisplay, isStackingDisplay, getEffectiveMaxStacks } from '../../data/abilities';
import { COMBAT_STYLES } from '../../data/abilities';
import { getRefImages, getDisplayImages, getIndicatorImages } from '../../data/icon-loader';

// Abilities that are tracked (matched + consume slots) but never rendered in the gauge.
// These exist to prevent false matches — their slots are consumed silently.
const GAUGE_EXCLUDED_IDS = new Set(['death_spark', 'death_essence_buff', 'death_essence_debuff', 'bone_shield']);

// ─── Necromancy mockup constants ──────────────────────────────────────────────
const PANEL_W = 340;
const PAD_X = 10;
const PAD_Y = 8;
const CONTENT_W = PANEL_W - PAD_X * 2;
const ROW_GAP = 5;

// Incantation per-ability accent colours
const INCANTATION_COLORS: Record<string, string> = {
    invoke_death: '#f472b6',
    threads: '#a78bfa',
    darkness: '#8b5cf6',
    split_soul_necro: '#818cf8',
};

/**
 * Modern Glass Panel renderer (Style C).
 *
 * Uses the group-based layout system from styleDef.groups to organize
 * abilities into visual sections. Falls back to type-based layout when
 * no groups are defined (for backward compatibility).
 */
export class ModernRenderer implements OverlayRenderer {

    // =====================================================================
    // Canvas Rendering — Necromancy-specific mockup layout
    // =====================================================================

    renderToCanvas(canvas: HTMLCanvasElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        const scale = state.overlayScale || 1.0;

        // Necromancy gets the custom mockup layout; others fall back
        if (def.id === 'necromancy') {
            this.renderNecromancyCanvas(canvas, state, def, scale);
        } else {
            this.renderGenericCanvas(canvas, state, def, scale);
        }
    }

    // ─── Necromancy canvas ────────────────────────────────────────────────

    private renderNecromancyCanvas(
        canvas: HTMLCanvasElement,
        state: AppState,
        def: StyleDef,
        scale: number,
    ): void {
        const dims = this.getMinDimensions(state, def);
        canvas.width = Math.round(dims.width * scale);
        canvas.height = Math.round(dims.height * scale);

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(scale, scale);

        // Background: dark purple gradient
        const grad = ctx.createLinearGradient(0, 0, 0, dims.height);
        grad.addColorStop(0, 'rgba(12,8,24,0.97)');
        grad.addColorStop(1, 'rgba(8,6,18,0.98)');
        ctx.fillStyle = grad;
        roundRect(ctx, 0, 0, dims.width, dims.height, 6);
        ctx.fill();

        // Border: purple tint
        ctx.strokeStyle = 'rgba(167,139,250,0.12)';
        ctx.lineWidth = 1;
        roundRect(ctx, 0.5, 0.5, dims.width - 1, dims.height - 1, 6);
        ctx.stroke();

        const hidden = new Set([...state.hiddenAbilities, ...GAUGE_EXCLUDED_IDS]);
        let y = PAD_Y;

        // ROW 1: Conjures (left) + Incantations (right) — side by side
        y = this.drawRow1(ctx, state, def, hidden, PAD_X, y, CONTENT_W);

        // ROW 2: Bloat timer bar (full width)
        y = this.drawRow2_Bloat(ctx, state, def, hidden, PAD_X, y, CONTENT_W);

        // ROW 3: Living Death + Death Skulls (prominent, side by side)
        y = this.drawRow3_Ultimates(ctx, state, def, hidden, PAD_X, y, CONTENT_W);

        // ROW 4: Residual Souls + Necrosis (stacks, side by side)
        y = this.drawRow4_Stacks(ctx, state, def, hidden, PAD_X, y, CONTENT_W);

        ctx.restore();
    }

    // ── ROW 1: Conjures + Incantations side by side ──────────────────────

    private drawRow1(
        ctx: CanvasRenderingContext2D,
        state: AppState,
        def: StyleDef,
        hidden: Set<string>,
        x: number, y: number, w: number,
    ): number {
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjures = def.abilities.filter(a => conjureIds.includes(a.id)).filter(c => !hidden.has(c.id));
        const incantationIds = ['invoke_death', 'threads', 'darkness', 'split_soul_necro'];
        const incantations = this.resolveAbilities(incantationIds, def).filter(a => !hidden.has(a.id));

        const showConjures = conjures.length > 0;
        const showIncantations = incantations.length > 0;
        if (!showConjures && !showIncantations) return y;

        const gap = 5;
        let leftW: number, rightW: number;
        if (showConjures && showIncantations) {
            leftW = (w - gap) / 2;
            rightW = (w - gap) / 2;
        } else {
            leftW = w;
            rightW = w;
        }

        let maxH = 0;

        if (showConjures) {
            const h = this.drawSectionPanel_Grid(
                ctx, conjures.map(c => ({
                    id: c.id, shortName: c.shortName, refImage: c.refImage,
                    color: '#4ecdc4',
                    isActive: state.abilities[c.id]?.active || false,
                    time: state.abilities[c.id]?.time || 0,
                })),
                'CONJURES', '#4ecdc4',
                x, y, leftW,
            );
            maxH = Math.max(maxH, h);
        }

        if (showIncantations) {
            const ox = showConjures ? x + leftW + gap : x;
            const ow = showConjures ? rightW : w;
            const h = this.drawSectionPanel_Grid(
                ctx, incantations.map(a => {
                    const as = state.abilities[a.id];
                    const active = as?.active && (as.time > 0 || a.type === 'enemy-debuff');
                    const accentColor = INCANTATION_COLORS[a.id] || '#a78bfa';
                    return {
                        id: a.id, shortName: a.shortName, refImage: a.refImage,
                        color: accentColor,
                        isActive: active,
                        time: as?.time || 0,
                    };
                }),
                'INCANTATIONS', '#a78bfa',
                ox, y, ow,
            );
            maxH = Math.max(maxH, h);
        }

        return y + maxH + ROW_GAP;
    }

    /** Generic 2x2 grid section panel with themed background and border */
    private drawSectionPanel_Grid(
        ctx: CanvasRenderingContext2D,
        items: { id: string; shortName: string; refImage?: string; color: string; isActive: boolean; time: number }[],
        label: string,
        themeColor: string,
        x: number, y: number, w: number,
    ): number {
        const [tr, tg, tb] = hexToRgb(themeColor);

        // Panel background + border
        ctx.fillStyle = `rgba(${tr},${tg},${tb},0.04)`;
        roundRect(ctx, x, y, w, 0.1, 4); // placeholder — we'll draw full height after measuring
        // We need to know final height — compute it first
        const labelH = 12; // label line height
        const cols = 2;
        const cellH = 22;
        const cellGap = 2;
        const rows = Math.ceil(items.length / cols);
        const gridH = rows * cellH + (rows - 1) * cellGap;
        const panelH = 5 + labelH + gridH + 4; // padding-top + label + grid + padding-bottom

        // Draw panel bg
        ctx.fillStyle = `rgba(${tr},${tg},${tb},0.04)`;
        roundRect(ctx, x, y, w, panelH, 4);
        ctx.fill();

        // Panel border
        ctx.strokeStyle = `rgba(${tr},${tg},${tb},0.1)`;
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y + 0.5, w - 1, panelH - 1, 4);
        ctx.stroke();

        // Section label
        let cy = y + 5;
        ctx.font = '500 7px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = `rgba(${tr},${tg},${tb},0.55)`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '1px';
        ctx.fillText(label, x + 5, cy);
        ctx.letterSpacing = '0px';
        cy += labelH;

        // Grid cells
        const innerPad = 5;
        const cellW = (w - innerPad * 2 - cellGap) / cols;

        for (let i = 0; i < items.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const item = items[i];
            const cx = x + innerPad + col * (cellW + cellGap);
            const cellY = cy + row * (cellH + cellGap);
            const [cr, cg, cb] = hexToRgb(item.color);

            if (item.isActive) {
                // Active cell background
                ctx.fillStyle = `rgba(${cr},${cg},${cb},0.08)`;
                roundRect(ctx, cx, cellY, cellW, cellH, 3);
                ctx.fill();
                // Left accent
                ctx.fillStyle = item.color;
                ctx.fillRect(cx, cellY + 3, 1.5, cellH - 6);
            } else {
                // Inactive cell
                ctx.fillStyle = 'rgba(255,255,255,0.015)';
                roundRect(ctx, cx, cellY, cellW, cellH, 3);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.06)';
                ctx.fillRect(cx, cellY + 3, 1.5, cellH - 6);
            }

            // Icon box (18x18)
            const iconSize = 18;
            const iconX = cx + 4;
            const iconY = cellY + (cellH - iconSize) / 2;

            if (item.isActive) {
                ctx.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;
                roundRect(ctx, iconX, iconY, iconSize, iconSize, 3);
                ctx.fill();
                ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.18)`;
                ctx.lineWidth = 1;
                roundRect(ctx, iconX + 0.5, iconY + 0.5, iconSize - 1, iconSize - 1, 3);
                ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.03)';
                roundRect(ctx, iconX, iconY, iconSize, iconSize, 3);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.04)';
                ctx.lineWidth = 1;
                roundRect(ctx, iconX + 0.5, iconY + 0.5, iconSize - 1, iconSize - 1, 3);
                ctx.stroke();
            }
            this.drawIcon(ctx, item.refImage, iconX, iconY, iconSize, item.isActive, item.color);

            // Text to the right of icon
            const textX = iconX + iconSize + 3;
            const textMaxW = cellW - iconSize - 10;

            // Name (7px)
            ctx.font = '7px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = item.isActive ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.18)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const name = this.truncateText(ctx, item.shortName, textMaxW);
            ctx.fillText(name, textX, cellY + 2);

            // Timer (9px monospace)
            ctx.font = '500 9px Consolas, "SF Mono", monospace';
            ctx.fillStyle = item.isActive ? item.color : 'rgba(255,255,255,0.1)';
            ctx.textBaseline = 'bottom';
            const timeStr = item.isActive ? (item.time > 0 ? formatTimeShort(item.time) : '\u2014') : '\u2014';
            ctx.fillText(timeStr, textX, cellY + cellH - 1);
        }

        return panelH;
    }

    // ── ROW 2: Bloat timer bar ───────────────────────────────────────────

    private drawRow2_Bloat(
        ctx: CanvasRenderingContext2D,
        state: AppState,
        def: StyleDef,
        hidden: Set<string>,
        x: number, y: number, w: number,
    ): number {
        const bloat = def.abilities.find(a => a.id === 'bloat');
        if (!bloat || hidden.has('bloat')) return y;

        const as = state.abilities['bloat'];
        const isActive = as?.active && (as.time > 0 || bloat.type === 'enemy-debuff');
        const barH = 26;

        // Bar background
        ctx.fillStyle = 'rgba(120,200,80,0.03)';
        roundRect(ctx, x, y, w, barH, 4);
        ctx.fill();

        // Bar border
        ctx.strokeStyle = 'rgba(140,80,200,0.12)';
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y + 0.5, w - 1, barH - 1, 4);
        ctx.stroke();

        // Progress fill
        if (isActive && bloat.internalDuration) {
            const progress = Math.min(1, as!.time / bloat.internalDuration);
            if (progress > 0) {
                ctx.save();
                roundRect(ctx, x, y, w, barH, 4);
                ctx.clip();

                const fillW = Math.max(8, w * progress);
                const fillGrad = ctx.createLinearGradient(x, 0, x + fillW, 0);
                fillGrad.addColorStop(0, 'rgba(120,200,80,0.15)');
                fillGrad.addColorStop(0.5, 'rgba(140,80,200,0.1)');
                fillGrad.addColorStop(1, 'rgba(140,80,200,0.04)');
                ctx.fillStyle = fillGrad;
                ctx.fillRect(x, y, fillW, barH);

                ctx.restore();
            }
        }

        // Icon (16x16) on left
        const iconSize = 16;
        const iconX = x + 8;
        const iconY = y + (barH - iconSize) / 2;
        ctx.fillStyle = 'rgba(140,80,200,0.15)';
        roundRect(ctx, iconX, iconY, iconSize, iconSize, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,80,200,0.2)';
        ctx.lineWidth = 1;
        roundRect(ctx, iconX + 0.5, iconY + 0.5, iconSize - 1, iconSize - 1, 3);
        ctx.stroke();
        this.drawIcon(ctx, bloat.refImage, iconX, iconY, iconSize, isActive, '#8c50c8');

        // "Bloat" label
        ctx.font = '500 10px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Bloat', iconX + iconSize + 6, y + barH / 2);

        // Timer (right)
        ctx.font = '500 12px Consolas, "SF Mono", monospace';
        ctx.fillStyle = isActive ? '#8c50c8' : 'rgba(255,255,255,0.15)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(isActive ? formatTimeShort(as!.time) : '\u2014', x + w - 8, y + barH / 2);

        return y + barH + ROW_GAP;
    }

    // ── ROW 3: Living Death + Death Skulls (prominent) ───────────────────

    private drawRow3_Ultimates(
        ctx: CanvasRenderingContext2D,
        state: AppState,
        def: StyleDef,
        hidden: Set<string>,
        x: number, y: number, w: number,
    ): number {
        const ldDef = def.abilities.find(a => a.id === 'living_death');
        const dsDef = def.abilities.find(a => a.id === 'death_skulls');
        const showLD = ldDef && !hidden.has('living_death');
        const showDS = dsDef && !hidden.has('death_skulls');
        if (!showLD && !showDS) return y;

        const gap = 5;
        const slotH = 44;
        const iconSize = 30;

        // Compute widths
        let ldW: number, dsW: number;
        if (showLD && showDS) {
            ldW = (w - gap) / 2;
            dsW = (w - gap) / 2;
        } else {
            ldW = w;
            dsW = w;
        }

        // Living Death slot
        if (showLD) {
            const as = state.abilities['living_death'];
            const isActive = as?.active && as.time > 0;

            // Background
            ctx.fillStyle = isActive ? 'rgba(192,132,252,0.06)' : 'rgba(255,255,255,0.015)';
            roundRect(ctx, x, y, ldW, slotH, 4);
            ctx.fill();

            // Border
            ctx.strokeStyle = isActive ? 'rgba(192,132,252,0.12)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            roundRect(ctx, x + 0.5, y + 0.5, ldW - 1, slotH - 1, 4);
            ctx.stroke();

            // Left accent (2px)
            ctx.fillStyle = isActive ? '#c084fc' : 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, y + 4, 2, slotH - 8);

            // Icon (30x30)
            const iconX = x + 7;
            const iconY = y + (slotH - iconSize) / 2;
            ctx.fillStyle = isActive ? 'rgba(192,132,252,0.1)' : 'rgba(255,255,255,0.02)';
            roundRect(ctx, iconX, iconY, iconSize, iconSize, 4);
            ctx.fill();
            ctx.strokeStyle = isActive ? 'rgba(192,132,252,0.15)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            roundRect(ctx, iconX + 0.5, iconY + 0.5, iconSize - 1, iconSize - 1, 4);
            ctx.stroke();
            this.drawIcon(ctx, ldDef!.refImage, iconX, iconY, iconSize, isActive, '#c084fc');

            // Name
            const textX = iconX + iconSize + 6;
            ctx.font = '8px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = isActive ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('Living Death', textX, y + 6);

            // Timer (large)
            ctx.font = '500 16px Consolas, "SF Mono", monospace';
            ctx.fillStyle = isActive ? '#c084fc' : 'rgba(255,255,255,0.1)';
            ctx.textBaseline = 'bottom';
            ctx.fillText(isActive ? formatTimeShort(as!.time) : '\u2014', textX, y + slotH - 5);
        }

        // Death Skulls slot (permanently inactive placeholder)
        if (showDS) {
            const dsX = showLD ? x + ldW + gap : x;
            const dsWActual = showLD ? dsW : w;
            const as = state.abilities['death_skulls'];
            const isActive = as?.active && as.time > 0;

            ctx.fillStyle = isActive ? 'rgba(167,139,250,0.04)' : 'rgba(255,255,255,0.015)';
            roundRect(ctx, dsX, y, dsWActual, slotH, 4);
            ctx.fill();

            ctx.strokeStyle = isActive ? 'rgba(167,139,250,0.08)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            roundRect(ctx, dsX + 0.5, y + 0.5, dsWActual - 1, slotH - 1, 4);
            ctx.stroke();

            ctx.fillStyle = isActive ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.06)';
            ctx.fillRect(dsX, y + 4, 2, slotH - 8);

            const iconX = dsX + 7;
            const iconY = y + (slotH - iconSize) / 2;
            ctx.fillStyle = isActive ? 'rgba(167,139,250,0.08)' : 'rgba(255,255,255,0.02)';
            roundRect(ctx, iconX, iconY, iconSize, iconSize, 4);
            ctx.fill();
            ctx.strokeStyle = isActive ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            roundRect(ctx, iconX + 0.5, iconY + 0.5, iconSize - 1, iconSize - 1, 4);
            ctx.stroke();
            this.drawIcon(ctx, dsDef!.refImage, iconX, iconY, iconSize, isActive, '#a78bfa');

            const textX = iconX + iconSize + 6;
            ctx.font = '8px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = isActive ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('Death Skulls', textX, y + 6);

            ctx.font = '500 16px Consolas, "SF Mono", monospace';
            ctx.fillStyle = isActive ? '#a78bfa' : 'rgba(255,255,255,0.1)';
            ctx.textBaseline = 'bottom';
            ctx.fillText(isActive ? formatTimeShort(as!.time) : '\u2014', textX, y + slotH - 5);
        }

        return y + slotH + ROW_GAP;
    }

    // ── ROW 4: Residual Souls + Necrosis ─────────────────────────────────

    private drawRow4_Stacks(
        ctx: CanvasRenderingContext2D,
        state: AppState,
        def: StyleDef,
        hidden: Set<string>,
        x: number, y: number, w: number,
    ): number {
        const soulsDef = def.abilities.find(a => a.id === 'souls');
        const necrosisDef = def.abilities.find(a => a.id === 'necrosis');
        const showSouls = soulsDef && !hidden.has('souls');
        const showNecrosis = necrosisDef && !hidden.has('necrosis');
        if (!showSouls && !showNecrosis) return y;

        const gap = 5;
        // Necrosis gets flex:1.5 relative to Souls flex:1
        let soulsW: number, necrosisW: number;
        if (showSouls && showNecrosis) {
            soulsW = (w - gap) * (1 / 2.5);
            necrosisW = (w - gap) * (1.5 / 2.5);
        } else {
            soulsW = w;
            necrosisW = w;
        }

        let maxH = 0;

        // Residual Souls
        if (showSouls) {
            const h = this.drawSoulsPanel(ctx, soulsDef!, state, x, y, soulsW);
            maxH = Math.max(maxH, h);
        }

        // Necrosis
        if (showNecrosis) {
            const nx = showSouls ? x + soulsW + gap : x;
            const nw = showSouls ? necrosisW : w;
            const h = this.drawNecrosisPanel(ctx, necrosisDef!, state, nx, y, nw);
            maxH = Math.max(maxH, h);
        }

        return y + maxH + ROW_GAP;
    }

    /** Residual Souls panel — custom soul icons */
    private drawSoulsPanel(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AppState,
        x: number, y: number, w: number,
    ): number {
        const stacks = state.abilities[ability.id]?.stacks || 0;
        const maxStacks = getEffectiveMaxStacks(ability, state.abilities, { noSoulboundLantern: state.noSoulboundLantern });

        const panelH = 52;

        // Panel background
        ctx.fillStyle = 'rgba(78,205,196,0.04)';
        roundRect(ctx, x, y, w, panelH, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(78,205,196,0.08)';
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y + 0.5, w - 1, panelH - 1, 4);
        ctx.stroke();

        // Label
        ctx.font = '500 7px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(78,205,196,0.6)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '1px';
        ctx.fillText('RESIDUAL SOULS', x + w / 2, y + 4);
        ctx.letterSpacing = '0px';

        // Soul icons row
        const iconSize = 14;
        const iconGap = 3;
        const totalIconsW = maxStacks * iconSize + (maxStacks - 1) * iconGap;
        let ix = x + (w - totalIconsW) / 2;
        const iconY = y + 16;

        const soulImg = getIndicatorImages()['soul'];

        for (let i = 0; i < maxStacks; i++) {
            const filled = i < stacks;

            if (soulImg) {
                if (filled) {
                    // Active: full opacity + glow
                    ctx.save();
                    ctx.shadowColor = 'rgba(78,205,196,0.5)';
                    ctx.shadowBlur = 4;
                    ctx.globalAlpha = 1.0;
                    ctx.drawImage(soulImg, ix, iconY, iconSize, iconSize);
                    ctx.restore();
                } else {
                    // Inactive: greyed out
                    ctx.save();
                    if (typeof ctx.filter === 'string') {
                        ctx.filter = 'grayscale(1) brightness(0.3)';
                        ctx.globalAlpha = 0.8;
                    } else {
                        ctx.globalAlpha = 0.2;
                    }
                    ctx.drawImage(soulImg, ix, iconY, iconSize, iconSize);
                    ctx.restore();
                }
            } else {
                // Fallback: colored circles
                ctx.beginPath();
                ctx.arc(ix + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
                if (filled) {
                    ctx.fillStyle = '#4ecdc4';
                    ctx.shadowColor = 'rgba(78,205,196,0.5)';
                    ctx.shadowBlur = 4;
                } else {
                    ctx.fillStyle = 'rgba(78,205,196,0.1)';
                    ctx.strokeStyle = 'rgba(78,205,196,0.15)';
                }
                ctx.fill();
                if (!filled) {
                    ctx.stroke();
                }
                ctx.shadowBlur = 0;
            }

            ix += iconSize + iconGap;
        }

        // Count text
        ctx.font = '500 11px Consolas, "SF Mono", monospace';
        ctx.fillStyle = stacks > 0 ? '#4ecdc4' : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${stacks} / ${maxStacks}`, x + w / 2, y + 34);

        return panelH;
    }

    /** Necrosis panel — custom skull icons in PAIRS */
    private drawNecrosisPanel(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AppState,
        x: number, y: number, w: number,
    ): number {
        const stacks = state.abilities[ability.id]?.stacks || 0;
        const maxStacks = getEffectiveMaxStacks(ability, state.abilities, { noSoulboundLantern: state.noSoulboundLantern });
        const splitAt = ability.splitAt || 6;

        const panelH = 52;

        // Panel background
        ctx.fillStyle = 'rgba(34,197,94,0.03)';
        roundRect(ctx, x, y, w, panelH, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(34,197,94,0.06)';
        ctx.lineWidth = 1;
        roundRect(ctx, x + 0.5, y + 0.5, w - 1, panelH - 1, 4);
        ctx.stroke();

        // Label
        ctx.font = '500 7px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(34,197,94,0.55)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.letterSpacing = '1px';
        ctx.fillText('NECROSIS', x + w / 2, y + 4);
        ctx.letterSpacing = '0px';

        // Skull icons in pairs with a split gap
        const skullW = 10;
        const skullH = 12;
        const pairInternalGap = 1;
        const pairGap = 3;
        const splitGapPx = 6;

        // Number of pairs
        const numPairs = Math.ceil(maxStacks / 2);
        const splitPairIdx = splitAt / 2; // pair index where the split gap goes (after this index)

        // Total width of all pairs + gaps + split
        const pairW = skullW * 2 + pairInternalGap;
        let totalW = numPairs * pairW + (numPairs - 1) * pairGap + splitGapPx;
        let startX = x + (w - totalW) / 2;
        const skullY = y + 16;

        const necrosisImg = getIndicatorImages()['necrosis'];

        let skullIdx = 0;
        for (let p = 0; p < numPairs; p++) {
            if (p === splitPairIdx) startX += splitGapPx;

            for (let s = 0; s < 2 && skullIdx < maxStacks; s++) {
                const filled = skullIdx < stacks;
                const sx = startX + s * (skullW + pairInternalGap);

                if (necrosisImg) {
                    if (filled) {
                        ctx.save();
                        ctx.shadowColor = 'rgba(34,197,94,0.4)';
                        ctx.shadowBlur = 2;
                        ctx.globalAlpha = 1.0;
                        ctx.drawImage(necrosisImg, sx, skullY, skullW, skullH);
                        ctx.restore();
                    } else {
                        ctx.save();
                        if (typeof ctx.filter === 'string') {
                            ctx.filter = 'grayscale(1) brightness(0.3)';
                            ctx.globalAlpha = 0.8;
                        } else {
                            ctx.globalAlpha = 0.2;
                        }
                        ctx.drawImage(necrosisImg, sx, skullY, skullW, skullH);
                        ctx.restore();
                    }
                } else {
                    // Fallback: simple rectangles
                    if (filled) {
                        ctx.fillStyle = '#22c55e';
                        ctx.shadowColor = 'rgba(34,197,94,0.4)';
                        ctx.shadowBlur = 2;
                    } else {
                        ctx.fillStyle = 'rgba(34,197,94,0.1)';
                        ctx.shadowBlur = 0;
                    }
                    roundRect(ctx, sx, skullY, skullW, skullH, 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }

                skullIdx++;
            }

            startX += pairW + pairGap;
        }

        // Count text
        ctx.font = '500 11px Consolas, "SF Mono", monospace';
        ctx.fillStyle = stacks > 0 ? '#22c55e' : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${stacks} / ${maxStacks}`, x + w / 2, y + 34);

        return panelH;
    }

    // =====================================================================
    // Generic (non-necromancy) canvas rendering — group-based
    // =====================================================================

    private renderGenericCanvas(
        canvas: HTMLCanvasElement,
        state: AppState,
        def: StyleDef,
        scale: number,
    ): void {
        const dims = this.getMinDimensions(state, def);
        canvas.width = Math.round(dims.width * scale);
        canvas.height = Math.round(dims.height * scale);

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(scale, scale);

        // Background
        ctx.fillStyle = 'rgba(8, 6, 16, 225)';
        roundRect(ctx, 0, 0, dims.width, dims.height, 8);
        ctx.fill();

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 20)';
        ctx.lineWidth = 1;
        roundRect(ctx, 0.5, 0.5, dims.width - 1, dims.height - 1, 8);
        ctx.stroke();

        let y = 10;
        const padX = 12;
        const contentW = dims.width - padX * 2;

        if (def.groups && def.groups.length > 0) {
            for (const group of def.groups) {
                y = this.drawGroup(ctx, group, state, def, padX, y, contentW);
            }
        } else {
            y = this.drawFallbackLayout(ctx, def, state, padX, y, contentW);
        }

        ctx.restore();
    }

    // =====================================================================
    // Group dispatcher (for non-necromancy styles)
    // =====================================================================

    private drawGroup(
        ctx: CanvasRenderingContext2D,
        group: AbilityGroup,
        state: AppState,
        def: StyleDef,
        x: number, y: number, w: number,
    ): number {
        // Thin divider between groups
        ctx.fillStyle = 'rgba(255, 255, 255, 10)';
        ctx.fillRect(x, y, w, 1);
        y += 5;

        // Group label
        ctx.font = '500 9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(group.name.toUpperCase(), x + 2, y);
        y += 13;

        switch (group.layout) {
            case 'prominent':
                return this.drawProminentGroup(ctx, group, state, def, x, y, w);
            case 'grid-2x2':
                return this.drawGridGroup(ctx, group, state, def, x, y, w);
            case 'row':
                return this.drawRowGroup(ctx, group, state, def, x, y, w);
            case 'bar':
                return this.drawBarGroup(ctx, group, state, def, x, y, w);
            default:
                return y;
        }
    }

    // =====================================================================
    // Layout: 'prominent' — large featured ability slot
    // =====================================================================

    private drawProminentGroup(
        ctx: CanvasRenderingContext2D,
        group: AbilityGroup,
        state: AppState,
        def: StyleDef,
        x: number, y: number, w: number,
    ): number {
        const abilities = this.resolveAbilities(group.abilityIds, def);
        const activeAbility = abilities.find(a => state.abilities[a.id]?.active) || abilities[0];
        if (!activeAbility) return y;

        const abilityState = state.abilities[activeAbility.id];
        const isActive = abilityState?.active && abilityState.time > 0;
        const [r, g, b] = hexToRgb(activeAbility.color);
        const rowH = 44;

        ctx.globalAlpha = isActive ? 1.0 : 0.4;

        // Background
        ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.12 : 0.03})`;
        roundRect(ctx, x, y, w, rowH, 6);
        ctx.fill();

        // Left accent bar
        ctx.fillStyle = isActive ? activeAbility.color : 'rgba(255,255,255,20)';
        ctx.fillRect(x, y + 6, 3, rowH - 12);

        // Large icon (36x36)
        const iconX = x + 10;
        const iconY = y + 4;
        const iconSize = 36;
        ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.2 : 0.08})`;
        roundRect(ctx, iconX, iconY, iconSize, iconSize, 5);
        ctx.fill();
        this.drawIcon(ctx, activeAbility.refImage, iconX, iconY, iconSize, isActive, activeAbility.color);

        // Name
        ctx.font = '500 13px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(activeAbility.shortName, iconX + iconSize + 10, y + 6);

        // Timer / cooldown text
        const timeStr = isActive ? formatTimeShort(abilityState!.time) : '\u2014';
        ctx.font = '500 18px Consolas, "SF Mono", monospace';
        ctx.fillStyle = isActive ? activeAbility.color : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(timeStr, iconX + iconSize + 10, y + rowH - 4);

        // CD indicator (right side)
        if (abilityState?.isOnCooldown) {
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('CD', x + w - 8, y + rowH / 2);
        }

        ctx.globalAlpha = 1.0;
        return y + rowH + 4;
    }

    // =====================================================================
    // Layout: 'grid-2x2' — 2-column grid of ability tiles
    // =====================================================================

    private drawGridGroup(
        ctx: CanvasRenderingContext2D,
        group: AbilityGroup,
        state: AppState,
        def: StyleDef,
        x: number, y: number, w: number,
    ): number {
        const abilities = this.resolveAbilities(group.abilityIds, def);
        const cols = 2;
        const gap = 4;
        const cellW = (w - gap) / cols;
        const cellH = 28;
        const rowGap = 3;

        for (let i = 0; i < abilities.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const cx = x + col * (cellW + gap);
            const cy = y + row * (cellH + rowGap);

            const ability = abilities[i];
            const abilityState = state.abilities[ability.id];
            const isActive = abilityState?.active && (abilityState.time > 0 || ability.type === 'enemy-debuff');
            const [r, g, b] = hexToRgb(ability.color);

            ctx.globalAlpha = isActive ? 1.0 : 0.35;

            // Cell background
            ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.1 : 0.02})`;
            roundRect(ctx, cx, cy, cellW, cellH, 4);
            ctx.fill();

            // Left accent
            ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,20)';
            ctx.fillRect(cx, cy + 4, 2, cellH - 8);

            // Icon (20x20)
            const iconSize = 20;
            const iX = cx + 6;
            const iY = cy + 4;
            ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.2 : 0.08})`;
            roundRect(ctx, iX, iY, iconSize, iconSize, 3);
            ctx.fill();
            this.drawIcon(ctx, ability.refImage, iX, iY, iconSize, isActive, ability.color);

            // Name (truncated to fit)
            ctx.font = '10px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const maxNameW = cellW - iconSize - 40;
            const name = this.truncateText(ctx, ability.shortName, maxNameW);
            ctx.fillText(name, iX + iconSize + 5, cy + cellH / 2);

            // Timer (right-aligned)
            const time = abilityState?.time || 0;
            ctx.font = '500 11px Consolas, "SF Mono", monospace';
            ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,0.2)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(isActive ? formatTimeShort(time) : '\u2014', cx + cellW - 6, cy + cellH / 2);

            ctx.globalAlpha = 1.0;
        }

        const rows = Math.ceil(abilities.length / cols);
        return y + rows * (cellH + rowGap) + 2;
    }

    // =====================================================================
    // Layout: 'row' — horizontal strip (conjures, stacks, or abilities)
    // =====================================================================

    private drawRowGroup(
        ctx: CanvasRenderingContext2D,
        group: AbilityGroup,
        state: AppState,
        def: StyleDef,
        x: number, y: number, w: number,
    ): number {
        // Check if this group contains conjures (by ID)
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjureAbilities = this.resolveAbilities(group.abilityIds, def).filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            return this.drawConjureRow(ctx, conjureAbilities, state, x, y, w);
        }

        // Check if stacking abilities
        const abilities = this.resolveAbilities(group.abilityIds, def);
        const hasStacks = abilities.some(a => isStackingDisplay(a.type));
        if (hasStacks) {
            return this.drawStackRow(ctx, abilities, state, x, y, w);
        }

        // Default: timer ability row (compact)
        return this.drawCompactAbilityRow(ctx, abilities, state, x, y, w);
    }

    // =====================================================================
    // Layout: 'bar' — full-width progress bar
    // =====================================================================

    private drawBarGroup(
        ctx: CanvasRenderingContext2D,
        group: AbilityGroup,
        state: AppState,
        def: StyleDef,
        x: number, y: number, w: number,
    ): number {
        const abilities = this.resolveAbilities(group.abilityIds, def);
        if (abilities.length === 0) return y;

        const ability = abilities[0];
        const abilityState = state.abilities[ability.id];
        const isActive = abilityState?.active && abilityState.time > 0;
        const [r, g, b] = hexToRgb(ability.color);
        const barH = 24;

        ctx.globalAlpha = isActive ? 1.0 : 0.35;

        // Bar background
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        roundRect(ctx, x, y, w, barH, 4);
        ctx.fill();

        // Progress fill
        if (isActive && ability.internalDuration) {
            const progress = Math.min(1, abilityState!.time / ability.internalDuration);
            if (progress > 0) {
                ctx.fillStyle = `rgba(${r},${g},${b},0.25)`;
                roundRect(ctx, x, y, Math.max(8, w * progress), barH, 4);
                ctx.fill();
            }
        }

        // Name (left)
        ctx.font = '10px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ability.shortName, x + 8, y + barH / 2);

        // Timer (right)
        const time = abilityState?.time || 0;
        ctx.font = '500 12px Consolas, "SF Mono", monospace';
        ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(isActive ? formatTimeShort(time) : '\u2014', x + w - 8, y + barH / 2);

        ctx.globalAlpha = 1.0;
        return y + barH + 4;
    }

    // =====================================================================
    // Shared drawing helpers
    // =====================================================================

    private drawConjureRow(
        ctx: CanvasRenderingContext2D,
        conjures: AbilityDef[],
        state: AppState,
        x: number, y: number, totalW: number,
    ): number {
        const gap = 3;
        const itemW = (totalW - gap * (conjures.length - 1)) / conjures.length;
        let ix = x;
        const rowH = 28;

        for (const conjure of conjures) {
            const cState = state.abilities[conjure.id];
            const active = cState?.active || false;
            const time = cState?.time || 0;

            // Background
            ctx.fillStyle = active ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.02)';
            roundRect(ctx, ix, y, itemW, rowH, 4);
            ctx.fill();

            // Icon (18x18)
            const iconSize = 18;
            const iX = ix + 3;
            const iY = y + 5;
            this.drawIcon(ctx, conjure.refImage, iX, iY, iconSize, active, '#22c55e');

            // Name
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = active ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const maxNameW = itemW - iconSize - 8;
            const name = this.truncateText(ctx, conjure.shortName, maxNameW);
            ctx.fillText(name, iX + iconSize + 3, y + 3);

            // Timer
            if (active && time > 0) {
                ctx.font = '500 9px Consolas, "SF Mono", monospace';
                ctx.fillStyle = '#22c55e';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(formatTimeShort(time), iX + iconSize + 3, y + rowH - 2);
            }

            ix += itemW + gap;
        }

        return y + rowH + 4;
    }

    private drawStackRow(
        ctx: CanvasRenderingContext2D,
        stackAbilities: AbilityDef[],
        state: AppState,
        x: number, y: number, totalW: number,
    ): number {
        const gap = 6;
        const groupW = (totalW - gap * (stackAbilities.length - 1)) / stackAbilities.length;
        let gx = x;
        const maxH = 46;

        for (const ability of stackAbilities) {
            const abilityState = state.abilities[ability.id];
            const stacks = abilityState?.stacks || 0;
            const maxStacks = getEffectiveMaxStacks(ability, state.abilities, { noSoulboundLantern: state.noSoulboundLantern });

            // Group background
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            roundRect(ctx, gx, y, groupW, maxH, 5);
            ctx.fill();

            // Label
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.shortName, gx + groupW / 2, y + 4);

            // Stack bars
            const barW = 5;
            const barH = 12;
            const barGap = 2;
            const splitGap = 4;

            let totalBarW = maxStacks * barW + (maxStacks - 1) * barGap;
            if (ability.splitAt) totalBarW += splitGap;
            let bx = gx + (groupW - totalBarW) / 2;

            for (let i = 0; i < maxStacks; i++) {
                if (ability.splitAt && i === ability.splitAt) bx += splitGap;
                const filled = i < stacks;
                ctx.fillStyle = filled ? ability.color : 'rgba(255,255,255,0.08)';
                roundRect(ctx, bx, y + 17, barW, barH, 2);
                ctx.fill();
                bx += barW + barGap;
            }

            // Count
            ctx.font = '500 12px Consolas, "SF Mono", monospace';
            ctx.fillStyle = stacks > 0 ? ability.color : 'rgba(255,255,255,0.2)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(String(stacks), gx + groupW / 2, y + 32);

            gx += groupW + gap;
        }

        return y + maxH + 4;
    }

    private drawCompactAbilityRow(
        ctx: CanvasRenderingContext2D,
        abilities: AbilityDef[],
        state: AppState,
        x: number, y: number, totalW: number,
    ): number {
        const gap = 3;
        const itemW = (totalW - gap * (abilities.length - 1)) / abilities.length;
        let ix = x;
        const rowH = 26;

        for (const ability of abilities) {
            const abilityState = state.abilities[ability.id];
            const isActive = abilityState?.active && abilityState.time > 0;
            const [r, g, b] = hexToRgb(ability.color);

            ctx.globalAlpha = isActive ? 1.0 : 0.35;

            ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.1 : 0.02})`;
            roundRect(ctx, ix, y, itemW, rowH, 4);
            ctx.fill();

            // Left accent
            ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,20)';
            ctx.fillRect(ix, y + 4, 2, rowH - 8);

            // Name
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const maxNameW = itemW - 36;
            const name = this.truncateText(ctx, ability.shortName, maxNameW);
            ctx.fillText(name, ix + 6, y + rowH / 2);

            // Timer
            const time = abilityState?.time || 0;
            ctx.font = '500 10px Consolas, "SF Mono", monospace';
            ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,0.2)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(isActive ? formatTimeShort(time) : '\u2014', ix + itemW - 4, y + rowH / 2);

            ctx.globalAlpha = 1.0;
            ix += itemW + gap;
        }

        return y + rowH + 4;
    }

    /** Draw an ability icon — uses display image (HTMLImageElement) first,
     *  falls back to detection ref (ImageData -> offscreen canvas), then colored dot. */
    private drawIcon(
        ctx: CanvasRenderingContext2D,
        refImageKey: string | undefined,
        x: number, y: number,
        size: number,
        isActive: boolean,
        color: string,
    ): void {
        if (refImageKey) {
            // Prefer display image (clean wiki icon, HTMLImageElement — works reliably in Alt1)
            const displayImages = getDisplayImages();
            const displayImg = displayImages[refImageKey];
            if (displayImg) {
                try {
                    ctx.save();
                    if (!isActive) ctx.globalAlpha = 0.25;
                    ctx.drawImage(displayImg, 1, 1, displayImg.width - 2, displayImg.height - 2,
                        x + 1, y + 1, size - 2, size - 2);
                    ctx.restore();
                    return;
                } catch (e) {
                    ctx.restore();
                    console.log(`[Renderer] Display icon failed for ${refImageKey}: ${e}`);
                }
            }

            // Fallback: detection ref image (ImageData -> offscreen canvas)
            const refImages = getRefImages();
            const refImg = refImages[refImageKey];
            if (refImg && refImg.width > 0 && refImg.height > 0) {
                try {
                    const tmpCanvas = document.createElement('canvas');
                    tmpCanvas.width = refImg.width;
                    tmpCanvas.height = refImg.height;
                    const tmpCtx = tmpCanvas.getContext('2d');
                    if (tmpCtx) {
                        tmpCtx.putImageData(refImg, 0, 0);
                        ctx.save();
                        if (!isActive) ctx.globalAlpha = 0.25;
                        ctx.drawImage(tmpCanvas, 1, 1, refImg.width - 2, refImg.height - 2,
                            x + 1, y + 1, size - 2, size - 2);
                        ctx.restore();
                        return;
                    }
                } catch (e) {
                    console.log(`[Renderer] Ref icon failed for ${refImageKey}: ${e}`);
                }
            }
        }
        // Fallback: colored dot
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, Math.min(size / 4, 5), 0, Math.PI * 2);
        ctx.fillStyle = isActive ? color : 'rgba(255,255,255,0.15)';
        ctx.fill();
    }

    /** Truncate text to fit within maxWidth */
    private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
        if (ctx.measureText(text).width <= maxWidth) return text;
        for (let i = text.length - 1; i > 0; i--) {
            const truncated = text.substring(0, i) + '\u2026';
            if (ctx.measureText(truncated).width <= maxWidth) return truncated;
        }
        return text[0] + '\u2026';
    }

    /** Resolve ability IDs to AbilityDef objects */
    private resolveAbilities(ids: string[], def: StyleDef): AbilityDef[] {
        return ids.map(id => def.abilities.find(a => a.id === id)).filter(Boolean) as AbilityDef[];
    }

    /** Resolve conjure IDs to AbilityDef objects */
    private resolveConjures(ids: string[], def: StyleDef): AbilityDef[] {
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        return ids.map(id => def.abilities.find(a => a.id === id && conjureIds.includes(a.id))).filter(Boolean) as AbilityDef[];
    }

    /** Fallback for styles without groups defined */
    private drawFallbackLayout(
        ctx: CanvasRenderingContext2D,
        def: StyleDef,
        state: AppState,
        x: number, y: number, w: number,
    ): number {
        // Timer abilities
        const timerAbilities = def.abilities.filter(a => isTimerDisplay(a.type));
        for (const ability of timerAbilities) {
            const abilityState = state.abilities[ability.id];
            const isActive = abilityState?.active && abilityState.time > 0;
            y = this.drawFallbackTimerRow(ctx, ability, abilityState, isActive, x, y, w);
        }

        // Stack abilities
        const stackAbilities = def.abilities.filter(a => isStackingDisplay(a.type));
        if (stackAbilities.length > 0) {
            y += 4;
            y = this.drawStackRow(ctx, stackAbilities, state, x, y, w);
        }

        // Conjures
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjureAbilities = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 10)';
            ctx.fillRect(x, y, w, 1);
            y += 5;
            y = this.drawConjureRow(ctx, conjureAbilities, state, x, y, w);
        }

        return y;
    }

    /** Single timer ability row for fallback layout */
    private drawFallbackTimerRow(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        abilityState: AbilityState | null,
        isActive: boolean,
        x: number, y: number, w: number,
    ): number {
        const rowH = 30;
        const [r, g, b] = hexToRgb(ability.color);

        ctx.globalAlpha = isActive ? 1.0 : 0.35;
        ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.1 : 0.02})`;
        roundRect(ctx, x, y, w, rowH, 5);
        ctx.fill();

        ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,20)';
        ctx.fillRect(x, y + 4, 2, rowH - 8);

        const iconX = x + 8;
        const iconY = y + 3;
        const iconSize = 24;
        ctx.fillStyle = `rgba(${r},${g},${b},${isActive ? 0.2 : 0.08})`;
        roundRect(ctx, iconX, iconY, iconSize, iconSize, 4);
        ctx.fill();
        this.drawIcon(ctx, ability.refImage, iconX, iconY, iconSize, isActive, ability.color);

        ctx.font = '11px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ability.shortName, iconX + iconSize + 8, y + rowH / 2);

        const time = abilityState?.time || 0;
        ctx.font = '500 13px Consolas, "SF Mono", monospace';
        ctx.fillStyle = isActive ? ability.color : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(isActive ? formatTimeShort(time) : '\u2014', x + w - 8, y + rowH / 2);

        ctx.globalAlpha = 1.0;
        return y + rowH + 3;
    }

    // =====================================================================
    // HTML Rendering (simplified, uses groups — for demo mode)
    // =====================================================================

    renderToHTML(container: HTMLElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        let html = '';

        if (def.groups && def.groups.length > 0) {
            for (const group of def.groups) {
                html += this.renderGroupHTML(group, state, def);
            }
        } else {
            // Fallback: type-based layout
            const timerAbilities = def.abilities.filter(a => isTimerDisplay(a.type));
            for (const ability of timerAbilities) {
                const s = state.abilities[ability.id];
                const isActive = s?.active && s.time > 0;
                html += this.renderTimerAbilityHTML(ability, s, isActive);
            }
            const stackAbilities = def.abilities.filter(a => isStackingDisplay(a.type));
            if (stackAbilities.length > 0) {
                html += '<div class="gauge-stacks-row">';
                for (const a of stackAbilities) html += this.renderStackAbilityHTML(a, state.abilities[a.id], state);
                html += '</div>';
            }
            const fallbackConjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
            const fallbackConjures = def.abilities.filter(a => fallbackConjureIds.includes(a.id));
            if (fallbackConjures.length > 0) html += this.renderConjuresHTML(fallbackConjures, state);
        }

        container.innerHTML = html;
    }

    private renderGroupHTML(group: AbilityGroup, state: AppState, def: StyleDef): string {
        let html = `<div class="gauge-section-divider" style="margin:4px 0;"></div>`;
        html += `<div style="font-size:9px; color:rgba(255,255,255,0.25); text-transform:uppercase; letter-spacing:0.5px; margin:2px 0 4px 4px;">${group.name}</div>`;

        const groupConjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const groupConjures = this.resolveAbilities(group.abilityIds, def).filter(a => groupConjureIds.includes(a.id));
        if (groupConjures.length > 0) {
            return html + this.renderConjuresHTML(groupConjures, state);
        }

        const abilities = this.resolveAbilities(group.abilityIds, def);
        if (abilities.length === 0) return html;

        const hasStacks = abilities.some(a => isStackingDisplay(a.type));
        if (hasStacks) {
            html += '<div class="gauge-stacks-row">';
            for (const a of abilities) html += this.renderStackAbilityHTML(a, state.abilities[a.id], state);
            html += '</div>';
            return html;
        }

        for (const ability of abilities) {
            const s = state.abilities[ability.id];
            const isActive = s?.active && (s.time > 0 || ability.type === 'enemy-debuff');
            html += this.renderTimerAbilityHTML(ability, s, isActive);
        }
        return html;
    }

    private renderTimerAbilityHTML(ability: AbilityDef, state: AbilityState | null, isActive: boolean): string {
        const time = state?.time || 0;
        const timeStr = formatTimeShort(time);
        const opacity = isActive ? '1' : '0.35';
        const borderColor = isActive ? ability.color : 'rgba(255,255,255,0.08)';

        return `
            <div class="gauge-ability" style="opacity: ${opacity}; border-left: 2px solid ${borderColor}; background: ${hexToRgba(ability.color, isActive ? 0.1 : 0.02)};">
                <div class="gauge-ability-info">
                    <span class="gauge-ability-name" style="${ability.shortName.length > 14 ? 'font-size:10px;' : ''}">${ability.shortName}</span>
                </div>
                <span class="gauge-ability-timer" style="color: ${isActive ? ability.color : 'rgba(255,255,255,0.2)'};">${isActive ? timeStr : '\u2014'}</span>
            </div>
        `;
    }

    private renderStackAbilityHTML(ability: AbilityDef, state: AbilityState | null, appState?: AppState): string {
        const stacks = state?.stacks || 0;
        const maxStacks = appState
            ? getEffectiveMaxStacks(ability, appState.abilities, { noSoulboundLantern: appState.noSoulboundLantern })
            : (ability.maxStacks || 1);

        let barsHtml = '';
        for (let i = 0; i < maxStacks; i++) {
            if (ability.splitAt && i === ability.splitAt) barsHtml += '<div class="gauge-stack-gap"></div>';
            const filled = i < stacks;
            barsHtml += `<div class="gauge-stack-bar" style="background: ${filled ? ability.color : 'rgba(255,255,255,0.08)'};"></div>`;
        }

        return `
            <div class="gauge-stack-group">
                <div class="gauge-stack-label">${ability.shortName}</div>
                <div class="gauge-stack-bars">${barsHtml}</div>
                <div class="gauge-stack-count" style="color: ${stacks > 0 ? ability.color : 'rgba(255,255,255,0.2)'};">${stacks}</div>
            </div>
        `;
    }

    private renderConjuresHTML(conjures: AbilityDef[], state: AppState): string {
        let itemsHtml = '';
        for (const conjure of conjures) {
            const cState = state.abilities[conjure.id];
            const active = cState?.active || false;
            const time = cState?.time || 0;
            const dotColor = active ? '#22c55e' : 'rgba(255,255,255,0.15)';
            const textColor = active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)';
            const bg = active ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)';

            itemsHtml += `
                <div class="gauge-conjure" style="background: ${bg};">
                    <div class="gauge-toggle-dot" style="background: ${dotColor};"></div>
                    <span class="gauge-toggle-name" style="color: ${textColor};">${conjure.shortName}</span>
                    ${active && time > 0 ? `<span style="font-size:9px; color:#22c55e; margin-left:auto; font-family:monospace;">${formatTimeShort(time)}</span>` : ''}
                </div>
            `;
        }
        return `<div class="gauge-conjures-row">${itemsHtml}</div>`;
    }

    // =====================================================================
    // Dimensions — matches new necromancy layout
    // =====================================================================

    getMinDimensions(state: AppState, styleDef?: StyleDef): { width: number; height: number } {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return { width: 260, height: 100 };

        if (def.id === 'necromancy') {
            return this.getNecromancyDimensions(state, def);
        }

        // Non-necromancy: keep original 260px width
        const width = 260;
        let height = 10;

        if (def.groups && def.groups.length > 0) {
            for (const group of def.groups) {
                height += 6 + 13;
                height += this.getGroupHeight(group, def);
            }
        } else {
            const timerCount = def.abilities.filter(a => isTimerDisplay(a.type)).length;
            height += timerCount * 33;
            const stackCount = def.abilities.filter(a => isStackingDisplay(a.type)).length;
            if (stackCount > 0) height += 4 + 50;
            const dimConjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
            if (def.abilities.some(a => dimConjureIds.includes(a.id))) height += 6 + 32;
        }

        height += 8;
        return { width, height };
    }

    private getNecromancyDimensions(state: AppState, def: StyleDef): { width: number; height: number } {
        const hidden = new Set([...state.hiddenAbilities, ...GAUGE_EXCLUDED_IDS]);
        let height = PAD_Y; // top padding

        // ROW 1: Conjures + Incantations (side by side)
        const dimConjureIds2 = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjures = def.abilities.filter(a => dimConjureIds2.includes(a.id)).filter(c => !hidden.has(c.id));
        const incantationIds = ['invoke_death', 'threads', 'darkness', 'split_soul_necro'];
        const incantations = this.resolveAbilities(incantationIds, def).filter(a => !hidden.has(a.id));
        if (conjures.length > 0 || incantations.length > 0) {
            // Both panels are the same height: label (12) + 2-row grid (2*22 + 2) + padding (5+4) = ~67
            const rows = Math.max(
                conjures.length > 0 ? Math.ceil(conjures.length / 2) : 0,
                incantations.length > 0 ? Math.ceil(incantations.length / 2) : 0,
            );
            const cellH = 22;
            const cellGap = 2;
            const gridH = rows * cellH + (rows - 1) * cellGap;
            const panelH = 5 + 12 + gridH + 4;
            height += panelH + ROW_GAP;
        }

        // ROW 2: Bloat bar
        if (!hidden.has('bloat')) {
            height += 26 + ROW_GAP;
        }

        // ROW 3: Living Death + Death Skulls
        const showLD = !hidden.has('living_death');
        const showDS = !hidden.has('death_skulls');
        if (showLD || showDS) {
            height += 44 + ROW_GAP;
        }

        // ROW 4: Residual Souls + Necrosis
        const showSouls = !hidden.has('souls');
        const showNecrosis = !hidden.has('necrosis');
        if (showSouls || showNecrosis) {
            height += 52 + ROW_GAP;
        }

        height += PAD_Y; // bottom padding
        return { width: PANEL_W, height };
    }

    private getGroupHeight(group: AbilityGroup, def: StyleDef): number {
        switch (group.layout) {
            case 'prominent':
                return 48;
            case 'grid-2x2': {
                const rows = Math.ceil(group.abilityIds.length / 2);
                return rows * 31 + 2;
            }
            case 'row': {
                const ghConjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
                if (group.abilityIds.some(id => ghConjureIds.includes(id))) return 32;
                const abilities = group.abilityIds.map(id => def.abilities.find(a => a.id === id)).filter(Boolean);
                if (abilities.some(a => a && isStackingDisplay(a.type))) return 50;
                return 30;
            }
            case 'bar':
                return 28;
            default:
                return 0;
        }
    }
}
