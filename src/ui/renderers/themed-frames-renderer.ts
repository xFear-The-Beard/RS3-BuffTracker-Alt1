import { OverlayRenderer, hexToRgba, hexToRgb, formatTimeShort, roundRect } from '../renderer';
import { AppState, AbilityState } from '../store';
import { StyleDef, AbilityDef, CombatStyle, isTimerDisplay, isStackingDisplay } from '../../data/abilities';
import { COMBAT_STYLES } from '../../data/abilities';
import { getRefImages, getDisplayImages } from '../../data/icon-loader';

// Abilities that are tracked (matched + consume slots) but never rendered in the gauge.
const GAUGE_EXCLUDED_IDS = new Set(['death_spark', 'death_essence_buff', 'death_essence_debuff', 'bone_shield']);

/**
 * Themed Icon Frames renderer (Style E).
 * Same rectangular panel layout as Styles A/B/C, but icon frames and decorative
 * accents are themed per combat style:
 * - Necromancy: rounded skull-motif frames, soul orbs in arc, necrosis rune bars
 * - Magic: hexagonal/rounded rune frames (border-radius:12px), crystalline accents
 * - Ranged: sharp angular frames (border-radius:4px), arrowhead P.Eq stacks
 * - Melee: diamond-rotated (45deg) frames, channel progress bars
 */
export class ThemedFramesRenderer implements OverlayRenderer {

    // =====================================================================
    // HTML Rendering — uses canvas in container for consistency
    // =====================================================================

    renderToHTML(container: HTMLElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        const canvas = document.createElement('canvas');
        this.renderToCanvas(canvas, state, def);
        container.innerHTML = '';
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        container.appendChild(canvas);
    }

    // =====================================================================
    // Canvas Rendering
    // =====================================================================

    renderToCanvas(canvas: HTMLCanvasElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        const dims = this.getMinDimensions(state, def);
        canvas.width = dims.width;
        canvas.height = dims.height;

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const style = def.id as CombatStyle;
        const [sr, sg, sb] = hexToRgb(def.color);

        // Background with style-specific tint
        const bgColors: Record<string, string> = {
            necromancy: 'rgba(8, 4, 18, 235)',
            magic: 'rgba(6, 4, 16, 235)',
            ranged: 'rgba(4, 8, 4, 235)',
            melee: 'rgba(12, 4, 4, 235)',
        };
        ctx.fillStyle = bgColors[style] || 'rgba(8, 6, 16, 235)';
        roundRect(ctx, 0, 0, canvas.width, canvas.height, 10);
        ctx.fill();

        // Border
        ctx.strokeStyle = `rgba(${sr},${sg},${sb},0.25)`;
        ctx.lineWidth = 1;
        roundRect(ctx, 0.5, 0.5, canvas.width - 1, canvas.height - 1, 10);
        ctx.stroke();

        const padX = 20;
        let y = 16;

        // Timer + toggle abilities as themed icon grid (excluding gauge-excluded IDs and conjures)
        const gridExcludeConjures = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const gridAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id) && !gridExcludeConjures.includes(a.id));
        const cols = 4;
        const iconSize = 48;
        const iconGap = 10;
        const totalGridW = cols * iconSize + (cols - 1) * iconGap;
        const gridStartX = padX + (canvas.width - padX * 2 - totalGridW) / 2;

        const ultimateIds = ['living_death', 'death_skulls'];
        const incantationIds = ['invoke_death', 'threads', 'darkness', 'split_soul_necro'];
        const isNecro = def.id === 'necromancy';

        if (isNecro) {
            const contentW = canvas.width - padX * 2;

            // Row 1: Ultimates (2 icons, larger, spread across full width)
            const ultimates = def.abilities.filter(a => ultimateIds.includes(a.id));
            if (ultimates.length > 0) {
                const ultIconSize = 56;
                const ultGap = Math.max(10, (contentW - ultimates.length * ultIconSize) / (ultimates.length + 1));
                let ux = padX + ultGap;
                for (const ability of ultimates) {
                    const abilityState = state.abilities[ability.id];
                    this.drawThemedIcon(ctx, ability, abilityState, ux, y, ultIconSize, style);
                    ux += ultIconSize + ultGap;
                }
                y += ultIconSize + 20; // larger label space
            }

            // Row 2: Incantations (4 icons, spread across full width)
            const incantations = def.abilities.filter(a => incantationIds.includes(a.id));
            if (incantations.length > 0) {
                const incCols = incantations.length;
                const incIconSize = 48;
                const incGap = Math.max(8, (contentW - incCols * incIconSize) / (incCols + 1));
                let ix = padX + incGap;
                for (const ability of incantations) {
                    const abilityState = state.abilities[ability.id];
                    this.drawThemedIcon(ctx, ability, abilityState, ix, y, incIconSize, style);
                    ix += incIconSize + incGap;
                }
                y += incIconSize + 18;
            }
        } else {
            // Non-necromancy: original 4-column flow
            let gx = gridStartX;
            let col = 0;
            for (const ability of gridAbilities) {
                const abilityState = state.abilities[ability.id];
                this.drawThemedIcon(ctx, ability, abilityState, gx, y, iconSize, style);
                col++;
                gx += iconSize + iconGap;
                if (col >= cols) {
                    col = 0;
                    gx = gridStartX;
                    y += iconSize + 18;
                }
            }
            if (col > 0) y += iconSize + 18;
        }

        // Stack abilities (excluding gauge-excluded IDs)
        const stackAbilities = def.abilities.filter(a => isStackingDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id));
        if (stackAbilities.length > 0) {
            y += 2;
            y = this.drawThemedStacks(ctx, stackAbilities, state, def, padX, y, canvas.width - padX * 2, style);
        }

        // Bloat progress bar (enemy-debuff, not caught by isTimerDisplay)
        const bloat = def.abilities.find(a => a.id === 'bloat');
        if (bloat) {
            y += 4;
            y = this.drawBloatBar(ctx, bloat, state, padX, y, canvas.width - padX * 2, style);
        }

        // Conjures (necromancy)
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjureAbilities = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            y += 2;
            // Divider
            ctx.fillStyle = `rgba(${sr},${sg},${sb},0.12)`;
            ctx.fillRect(padX, y, canvas.width - padX * 2, 1);
            y += 8;
            y = this.drawThemedConjures(ctx, conjureAbilities, state, padX, y, canvas.width - padX * 2);
        }

        // Melee channels (special section)
        if (style === 'melee') {
            const channelAbilities = def.abilities.filter(a =>
                a.id === 'slaughter' || a.id === 'assault' || a.id === 'destroy'
            );
            if (channelAbilities.length > 0) {
                y += 2;
                ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
                ctx.fillRect(padX, y, canvas.width - padX * 2, 1);
                y += 8;
                y = this.drawChannelBars(ctx, channelAbilities, state, padX, y, canvas.width - padX * 2);
            }
        }
    }

    /**
     * Draw a themed icon frame. Frame shape varies by combat style.
     */
    private drawThemedIcon(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        abilityState: AbilityState | null,
        x: number, y: number,
        size: number,
        style: CombatStyle,
    ): void {
        const active = abilityState?.active || false;

        ctx.globalAlpha = active ? 1.0 : 0.25;

        switch (style) {
            case 'necromancy':
                this.drawRoundedIconFrame(ctx, x, y, size, ability, abilityState, 8);
                break;
            case 'magic':
                this.drawRoundedIconFrame(ctx, x, y, size, ability, abilityState, 12);
                break;
            case 'ranged':
                this.drawRoundedIconFrame(ctx, x, y, size, ability, abilityState, 4);
                break;
            case 'melee':
                this.drawDiamondIconFrame(ctx, x, y, size, ability, abilityState);
                break;
            default:
                this.drawRoundedIconFrame(ctx, x, y, size, ability, abilityState, 8);
        }

        ctx.globalAlpha = 1.0;
    }

    private drawRoundedIconFrame(
        ctx: CanvasRenderingContext2D,
        x: number, y: number, size: number,
        ability: AbilityDef,
        abilityState: AbilityState | null,
        borderRadius: number,
    ): void {
        const active = abilityState?.active || false;
        const [r, g, b] = hexToRgb(ability.color);

        // Frame background
        ctx.fillStyle = active
            ? `rgba(${r},${g},${b},0.1)`
            : 'rgba(255,255,255,0.03)';
        roundRect(ctx, x, y, size, size, borderRadius);
        ctx.fill();

        // Frame border
        ctx.strokeStyle = active
            ? `rgba(${r},${g},${b},0.5)`
            : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.5;
        roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, borderRadius);
        ctx.stroke();

        // Icon image or fallback dot
        this.drawIcon(ctx, ability.refImage, x + 2, y + 2, size - 4, active, ability.color);

        // Timer overlay at bottom
        if (active) {
            const overlayH = 14;
            const overlayY = y + size - overlayH;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.beginPath();
            ctx.moveTo(x, overlayY);
            ctx.lineTo(x + size, overlayY);
            ctx.lineTo(x + size, y + size - borderRadius);
            ctx.arcTo(x + size, y + size, x + size - borderRadius, y + size, borderRadius);
            ctx.lineTo(x + borderRadius, y + size);
            ctx.arcTo(x, y + size, x, y + size - borderRadius, borderRadius);
            ctx.closePath();
            ctx.fill();

            const text = formatTimeShort(abilityState?.time || 0);

            ctx.font = '500 11px Consolas, "SF Mono", monospace';
            ctx.fillStyle = ability.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + size / 2, overlayY + overlayH / 2);
        }

        // Label below
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(ability.shortName, x + size / 2, y + size + 4);
    }

    private drawDiamondIconFrame(
        ctx: CanvasRenderingContext2D,
        x: number, y: number, size: number,
        ability: AbilityDef,
        abilityState: AbilityState | null,
    ): void {
        const active = abilityState?.active || false;
        const [r, g, b] = hexToRgb(ability.color);
        const cx = x + size / 2;
        const cy = y + size / 2;
        const half = size / 2 - 2;

        // Diamond shape
        ctx.beginPath();
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx + half, cy);
        ctx.lineTo(cx, cy + half);
        ctx.lineTo(cx - half, cy);
        ctx.closePath();

        ctx.fillStyle = active
            ? `rgba(${r},${g},${b},0.06)`
            : 'rgba(255,255,255,0.02)';
        ctx.fill();

        ctx.strokeStyle = active
            ? `rgba(${r},${g},${b},0.5)`
            : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Icon image or fallback dot
        const iconDrawSize = half;
        this.drawIcon(ctx, ability.refImage, cx - iconDrawSize / 2, cy - iconDrawSize / 2 - 4, iconDrawSize, active, ability.color);

        // Timer inside diamond
        if (active) {
            const text = formatTimeShort(abilityState?.time || 0);

            ctx.font = '500 10px Consolas, "SF Mono", monospace';
            ctx.fillStyle = ability.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, cx, cy + 8);
        }

        // Label below diamond
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(ability.shortName, cx, y + size + 4);
    }

    /**
     * Draw themed stack indicators.
     */
    private drawThemedStacks(
        ctx: CanvasRenderingContext2D,
        stackAbilities: AbilityDef[],
        state: AppState,
        def: StyleDef,
        x: number, y: number,
        totalW: number,
        style: CombatStyle,
    ): number {
        const gap = 16;
        const groupW = (totalW - gap * (stackAbilities.length - 1)) / stackAbilities.length;
        let gx = x;

        for (const ability of stackAbilities) {
            const abilityState = state.abilities[ability.id];
            const stacks = abilityState?.stacks || 0;
            const maxStacks = ability.maxStacks || 1;
            const [r, g, b] = hexToRgb(ability.color);

            // Title
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.shortName.toUpperCase(), gx + groupW / 2, y);

            if (style === 'necromancy' && ability.id === 'souls') {
                // Soul orbs
                const dotR = 7;
                const dotGap = 6;
                const totalDotsW = maxStacks * dotR * 2 + (maxStacks - 1) * dotGap;
                let dx = gx + (groupW - totalDotsW) / 2 + dotR;

                for (let i = 0; i < maxStacks; i++) {
                    const filled = i < stacks;
                    ctx.beginPath();
                    ctx.arc(dx, y + 22, dotR, 0, Math.PI * 2);
                    ctx.fillStyle = filled ? '#22c55e' : 'rgba(34,197,94,0.08)';
                    ctx.fill();
                    ctx.strokeStyle = filled ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.1)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    dx += dotR * 2 + dotGap;
                }
            } else if (style === 'ranged' && ability.id === 'perfect_equilibrium') {
                // Arrowhead shapes
                const arrowW = 12;
                const arrowH = 18;
                const arrowGap = 4;
                const totalArrowW = maxStacks * arrowW + (maxStacks - 1) * arrowGap;
                let ax = gx + (groupW - totalArrowW) / 2;

                for (let i = 0; i < maxStacks; i++) {
                    const filled = i < stacks;
                    const acx = ax + arrowW / 2;
                    const acy = y + 24;

                    ctx.beginPath();
                    ctx.moveTo(acx, acy - arrowH / 2);
                    ctx.lineTo(acx + arrowW / 2, acy - arrowH / 4);
                    ctx.lineTo(acx, acy + arrowH / 2);
                    ctx.lineTo(acx - arrowW / 2, acy - arrowH / 4);
                    ctx.closePath();

                    ctx.fillStyle = filled ? '#f472b6' : 'rgba(255,255,255,0.06)';
                    ctx.fill();
                    if (!filled) {
                        ctx.strokeStyle = 'rgba(244,114,182,0.2)';
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }

                    ax += arrowW + arrowGap;
                }
            } else {
                // Default bars (necrosis style)
                const barW = 8;
                const barH = 14;
                const barGap = 2;
                const splitGap = 4;
                let totalBarW = maxStacks * barW + (maxStacks - 1) * barGap;
                if (ability.splitAt) totalBarW += splitGap;
                let bx = gx + (groupW - totalBarW) / 2;

                for (let i = 0; i < maxStacks; i++) {
                    if (ability.splitAt && i === ability.splitAt) bx += splitGap;
                    const filled = i < stacks;
                    ctx.fillStyle = filled ? ability.color : 'rgba(255,255,255,0.08)';
                    roundRect(ctx, bx, y + 16, barW, barH, 2);
                    ctx.fill();
                    bx += barW + barGap;
                }
            }

            // Count
            ctx.font = '500 13px Consolas, "SF Mono", monospace';
            ctx.fillStyle = stacks > 0 ? ability.color : `rgba(${r},${g},${b},0.2)`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${stacks} / ${maxStacks}`, gx + groupW / 2, y + 38);

            gx += groupW + gap;
        }

        return y + 56;
    }

    /**
     * Draw conjures with unique silhouette shapes per conjure.
     */
    private drawThemedConjures(
        ctx: CanvasRenderingContext2D,
        conjures: AbilityDef[],
        appState: AppState,
        x: number, y: number,
        totalW: number,
    ): number {
        const gap = 12;
        const itemW = (totalW - gap * (conjures.length - 1)) / conjures.length;
        let ix = x;
        const iconH = 24;
        const iconW = 20;

        for (const conjure of conjures) {
            const cState = appState.abilities[conjure.id];
            const active = cState?.active || false;
            const cx = ix + itemW / 2;

            // Conjure icon frame
            ctx.fillStyle = active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)';
            roundRect(ctx, cx - iconW / 2, y, iconW, iconH, 4);
            ctx.fill();
            ctx.strokeStyle = active ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            roundRect(ctx, cx - iconW / 2 + 0.5, y + 0.5, iconW - 1, iconH - 1, 4);
            ctx.stroke();

            // Conjure icon or fallback shape
            const conjIconSize = Math.min(iconW - 4, iconH - 4);
            this.drawIcon(ctx, conjure.refImage, cx - conjIconSize / 2, y + (iconH - conjIconSize) / 2, conjIconSize, active, '#22c55e');

            // Label
            ctx.font = '8px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = active ? '#86efac' : 'rgba(255,255,255,0.3)';
            ctx.fillText(conjure.shortName, cx, y + iconH + 8);

            ix += itemW + gap;
        }

        return y + iconH + 16;
    }

    /**
     * Draw Bloat progress bar in the themed frames style.
     */
    private drawBloatBar(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AppState,
        x: number, y: number,
        totalW: number,
        style: CombatStyle,
    ): number {
        const abilityState = state.abilities[ability.id];
        const active = abilityState?.active || false;
        const time = abilityState?.time || 0;
        const maxTime = ability.internalDuration || 20.5;
        const pct = active ? Math.min(time / maxTime, 1) : 0;
        const [r, g, b] = hexToRgb(ability.color);

        const barH = 36;
        const barW = totalW;

        // Bar container
        ctx.fillStyle = `rgba(${r},${g},${b},0.06)`;
        roundRect(ctx, x, y, barW, barH, 5);
        ctx.fill();

        // Title
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(ability.shortName.toUpperCase(), x + barW / 2, y + 4);

        // Icon
        const iconSize = 14;
        this.drawIcon(ctx, ability.refImage, x + 6, y + 4, iconSize, active, ability.color);

        // Progress bar
        const pBarX = x + 6;
        const pBarY = y + 17;
        const pBarW = barW - 12;
        const pBarH = 4;

        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRect(ctx, pBarX, pBarY, pBarW, pBarH, 2);
        ctx.fill();

        if (active && pct > 0) {
            const fillW = Math.max(pct * pBarW, pBarH);
            ctx.fillStyle = ability.color;
            roundRect(ctx, pBarX, pBarY, fillW, pBarH, 2);
            ctx.fill();
        }

        // Status text
        ctx.font = '500 11px Consolas, "SF Mono", monospace';
        ctx.fillStyle = active ? ability.color : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(active ? formatTimeShort(time) : '\u2014', x + barW / 2, y + 23);

        return y + barH + 4;
    }

    /**
     * Draw melee channel/bleed progress bars.
     */
    private drawChannelBars(
        ctx: CanvasRenderingContext2D,
        abilities: AbilityDef[],
        state: AppState,
        x: number, y: number,
        totalW: number,
    ): number {
        const gap = 8;
        const barW = (totalW - gap * (abilities.length - 1)) / abilities.length;
        const barTotalH = 36;
        let bx = x;

        for (const ability of abilities) {
            const abilityState = state.abilities[ability.id];
            const active = abilityState?.active || false;
            const time = abilityState?.time || 0;
            const [r, g, b] = hexToRgb(ability.color);

            // Bar container
            ctx.fillStyle = `rgba(${r},${g},${b},0.06)`;
            roundRect(ctx, bx, y, barW, barTotalH, 5);
            ctx.fill();

            // Title
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.shortName.toUpperCase(), bx + barW / 2, y + 4);

            // Progress bar
            const pBarX = bx + 6;
            const pBarY = y + 17;
            const pBarW = barW - 12;
            const pBarH = 4;

            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            roundRect(ctx, pBarX, pBarY, pBarW, pBarH, 2);
            ctx.fill();

            if (active && time > 0) {
                const pct = Math.min(time / 10, 1);
                const fillW = Math.max(pct * pBarW, pBarH);
                ctx.fillStyle = ability.color;
                roundRect(ctx, pBarX, pBarY, fillW, pBarH, 2);
                ctx.fill();
            }

            // Status text
            ctx.font = '500 11px Consolas, "SF Mono", monospace';
            ctx.fillStyle = active ? ability.color : 'rgba(255,255,255,0.2)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(active ? `${formatTimeShort(time)}` : 'Ready', bx + barW / 2, y + 23);

            bx += barW + gap;
        }

        return y + barTotalH + 4;
    }

    // =====================================================================
    // Icon drawing helper
    // =====================================================================

    /** Draw an ability/conjure icon — uses display image first, falls back to ref image, then colored dot. */
    private drawIcon(
        ctx: CanvasRenderingContext2D,
        refImageKey: string | undefined,
        x: number, y: number,
        size: number,
        isActive: boolean,
        color: string,
    ): void {
        if (refImageKey) {
            const displayImages = getDisplayImages();
            const displayImg = displayImages[refImageKey];
            if (displayImg) {
                try {
                    ctx.save();
                    if (!isActive) ctx.globalAlpha = 0.25;
                    ctx.drawImage(displayImg, x, y, size, size);
                    ctx.restore();
                    return;
                } catch (e) { ctx.restore(); }
            }

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
                        ctx.drawImage(tmpCanvas, x, y, size, size);
                        ctx.restore();
                        return;
                    }
                } catch (e) { /* fallback */ }
            }
        }
        // Fallback: colored dot
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, Math.min(size / 4, 5), 0, Math.PI * 2);
        ctx.fillStyle = isActive ? color : 'rgba(255,255,255,0.15)';
        ctx.fill();
    }

    // =====================================================================
    // Dimensions
    // =====================================================================

    getMinDimensions(state: AppState, styleDef?: StyleDef): { width: number; height: number } {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return { width: 340, height: 200 };

        const width = 340;
        let height = 16; // top padding

        // Icon grid (excluding gauge-excluded IDs and conjures)
        const gridExcludeConjures = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const gridAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id) && !gridExcludeConjures.includes(a.id));
        const cols = 4;
        const rows = Math.ceil(gridAbilities.length / cols);
        height += rows * (48 + 18); // icon + label

        if (def.id === 'necromancy') {
            height = 16; // reset from top padding
            height += (56 + 20); // ultimates row (56px icons + label)
            height += (48 + 18); // incantations row (48px icons + label)
        }

        // Stacks (excluding gauge-excluded IDs)
        const stackCount = def.abilities.filter(a => isStackingDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id)).length;
        if (stackCount > 0) {
            height += 2 + 56;
        }

        // Bloat bar
        const hasBloat = def.abilities.some(a => a.id === 'bloat');
        if (hasBloat) {
            height += 4 + 36 + 4; // gap + bar + gap
        }

        // Conjures
        const dimConjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        if (def.abilities.some(a => dimConjureIds.includes(a.id))) {
            height += 2 + 1 + 8 + 24 + 16; // gap + divider + gap + icons + labels
        }

        // Melee channels
        if ((def.id as CombatStyle) === 'melee') {
            const channelCount = def.abilities.filter(a =>
                a.id === 'slaughter' || a.id === 'assault' || a.id === 'destroy'
            ).length;
            if (channelCount > 0) {
                height += 2 + 1 + 8 + 36 + 4;
            }
        }

        height += 16; // bottom padding
        return { width, height };
    }
}
