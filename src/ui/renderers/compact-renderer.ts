import { OverlayRenderer, hexToRgba, hexToRgb, formatTimeShort, roundRect } from '../renderer';
import { AppState, AbilityState } from '../store';
import { StyleDef, AbilityDef, isTimerDisplay, isStackingDisplay } from '../../data/abilities';
import { COMBAT_STYLES } from '../../data/abilities';
import { getRefImages, getDisplayImages } from '../../data/icon-loader';

// Abilities that are tracked (matched + consume slots) but never rendered in the gauge.
const GAUGE_EXCLUDED_IDS = new Set(['death_spark', 'death_essence_buff', 'death_essence_debuff', 'bone_shield']);

/**
 * Compact Horizontal Flow renderer (Style A).
 * Low-profile, horizontally flowing layout with pill-shaped ability items.
 * Minimal vertical footprint - designed for users who want minimal screen obstruction.
 */
export class CompactRenderer implements OverlayRenderer {

    // =====================================================================
    // HTML Rendering
    // =====================================================================

    renderToHTML(container: HTMLElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        let html = '';

        // Abilities rendered in dedicated sections (not pills)
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const dedicatedIds = new Set([...GAUGE_EXCLUDED_IDS, ...conjureIds, 'bloat']);
        const displayAbilities = def.abilities.filter(a => !dedicatedIds.has(a.id));
        html += '<div class="compact-pills">';
        for (const ability of displayAbilities) {
            const abilityState = state.abilities[ability.id];
            html += this.renderPillHTML(ability, abilityState);
        }
        html += '</div>';

        // Conjures
        const conjures = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjures.length > 0) {
            html += '<div class="compact-conjures">';
            for (const conjure of conjures) {
                const active = state.abilities[conjure.id]?.active || false;
                const dotColor = active ? '#86efac' : 'rgba(255,255,255,0.2)';
                const textColor = active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
                html += `
                    <div class="compact-conjure">
                        <span class="compact-conjure-dot" style="background: ${dotColor};"></span>
                        <span class="compact-conjure-name" style="color: ${textColor};">${conjure.shortName}</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    private renderPillHTML(ability: AbilityDef, state: AbilityState | null): string {
        const active = state?.active || false;
        const opacity = active ? '1' : '0.35';
        const [r, g, b] = hexToRgb(ability.color);

        let valueStr: string;
        if (isStackingDisplay(ability.type)) {
            const stacks = state?.stacks || 0;
            valueStr = `\u00D7${stacks}`;
        } else if (isTimerDisplay(ability.type)) {
            valueStr = active ? formatTimeShort(state?.time || 0) : '\u2014';
        } else {
            valueStr = active ? formatTimeShort(state?.time || 0) : '\u2014';
        }

        const valueColor = active ? ability.color : 'rgba(255,255,255,0.25)';
        const iconBg = active
            ? `linear-gradient(135deg, ${hexToRgba(ability.color, 0.35)}, ${hexToRgba(ability.color, 0.15)})`
            : 'rgba(255,255,255,0.05)';
        const iconBorder = active
            ? `1px solid ${hexToRgba(ability.color, 0.5)}`
            : '1px solid rgba(255,255,255,0.08)';

        return `
            <div class="compact-pill" style="opacity: ${opacity};">
                <div class="compact-pill-icon" style="background: ${iconBg}; border: ${iconBorder};">
                    <span style="color: ${active ? ability.color : 'rgba(255,255,255,0.3)'};">\u25CF</span>
                </div>
                <div class="compact-pill-text">
                    <span class="compact-pill-name">${ability.shortName}</span>
                    <span class="compact-pill-value" style="color: ${valueColor};">${valueStr}</span>
                </div>
            </div>
        `;
    }

    // =====================================================================
    // Canvas Rendering
    // =====================================================================

    renderToCanvas(canvas: HTMLCanvasElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        const scale = state.overlayScale || 1.0;
        const dims = this.getMinDimensions(state, def);
        canvas.width = Math.round(dims.width * scale);
        canvas.height = Math.round(dims.height * scale);

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(scale, scale);

        // Background
        ctx.fillStyle = 'rgba(10, 8, 20, 209)'; // 0.82 * 255
        roundRect(ctx, 0, 0, dims.width, dims.height, 6);
        ctx.fill();

        // Border
        ctx.strokeStyle = 'rgba(255, 255, 255, 20)';
        ctx.lineWidth = 1;
        roundRect(ctx, 0.5, 0.5, dims.width - 1, dims.height - 1, 6);
        ctx.stroke();

        const padX = 12;
        let y = 8;

        // Ability pills in rows
        const pillW = 72;
        const pillH = 26;
        const pillGap = 4;
        const maxPerRow = Math.floor((dims.width - padX * 2 + pillGap) / (pillW + pillGap));

        let px = padX;
        let rowCount = 0;

        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const dedicatedIds = new Set([...GAUGE_EXCLUDED_IDS, ...conjureIds, 'bloat']);
        const displayAbilities = def.abilities.filter(a => !dedicatedIds.has(a.id));
        for (const ability of displayAbilities) {
            const abilityState = state.abilities[ability.id];
            this.drawPill(ctx, ability, abilityState, px, y, pillW, pillH);

            px += pillW + pillGap;
            rowCount++;

            if (rowCount >= maxPerRow) {
                px = padX;
                y += pillH + pillGap;
                rowCount = 0;
            }
        }

        // Move y past incomplete row
        if (rowCount > 0) {
            y += pillH + pillGap;
        }

        // Conjures
        const conjureAbilities = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            // Bloat progress bar (acts as separator between pills and conjures)
            const bloat = def.abilities.find(a => a.id === 'bloat');
            if (bloat) {
                const bloatState = state.abilities['bloat'];
                const isActive = bloatState?.active && (bloatState.time > 0 || bloat.type === 'enemy-debuff');
                const barH = 20;

                // Bar background
                ctx.fillStyle = 'rgba(120,200,80,0.03)';
                roundRect(ctx, padX, y, dims.width - padX * 2, barH, 4);
                ctx.fill();

                ctx.strokeStyle = 'rgba(140,80,200,0.12)';
                ctx.lineWidth = 1;
                roundRect(ctx, padX + 0.5, y + 0.5, dims.width - padX * 2 - 1, barH - 1, 4);
                ctx.stroke();

                if (isActive && bloat.internalDuration) {
                    const progress = Math.min(1, bloatState!.time / bloat.internalDuration);
                    if (progress > 0) {
                        ctx.save();
                        roundRect(ctx, padX, y, dims.width - padX * 2, barH, 4);
                        ctx.clip();
                        const fillW = Math.max(8, (dims.width - padX * 2) * progress);
                        ctx.fillStyle = 'rgba(140,80,200,0.12)';
                        ctx.fillRect(padX, y, fillW, barH);
                        ctx.restore();
                    }
                }

                // Icon
                const bIconSize = 14;
                this.drawIcon(ctx, bloat.refImage, padX + 4, y + (barH - bIconSize) / 2, bIconSize, isActive || false, '#8c50c8');

                // Label
                ctx.font = '9px "Segoe UI", system-ui, sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText('Bloat', padX + 4 + bIconSize + 4, y + barH / 2);

                // Timer
                ctx.font = '500 10px Consolas, "SF Mono", monospace';
                ctx.fillStyle = isActive ? '#8c50c8' : 'rgba(255,255,255,0.15)';
                ctx.textAlign = 'right';
                ctx.fillText(isActive ? formatTimeShort(bloatState!.time) : '\u2014', dims.width - padX - 4, y + barH / 2);

                y += barH + 4;
            }

            // Conjure pills (same size as ability pills)
            const cPillGap = 4;
            const cPillW = (dims.width - padX * 2 - cPillGap * (conjureAbilities.length - 1)) / conjureAbilities.length;
            const cPillH = 26;
            let cx = padX;
            for (const conjure of conjureAbilities) {
                const abilityState = state.abilities[conjure.id];
                this.drawPill(ctx, conjure, abilityState, cx, y, cPillW, cPillH);
                cx += cPillW + cPillGap;
            }
            y += cPillH + 4;
        }

        ctx.restore();
    }

    private drawPill(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AbilityState | null,
        x: number, y: number,
        w: number, h: number,
    ): void {
        const active = state?.active || false;
        const [r, g, b] = hexToRgb(ability.color);

        ctx.globalAlpha = active ? 1.0 : 0.35;

        // Pill background
        ctx.fillStyle = `rgba(${r},${g},${b},${active ? 0.08 : 0.03})`;
        roundRect(ctx, x, y, w, h, 4);
        ctx.fill();

        // Icon square
        const iconSize = 22;
        const iconX = x + 2;
        const iconY = y + 2;

        ctx.fillStyle = active
            ? `rgba(${r},${g},${b},0.25)`
            : 'rgba(255,255,255,0.05)';
        roundRect(ctx, iconX, iconY, iconSize, iconSize, 3);
        ctx.fill();

        // Icon border
        ctx.strokeStyle = active
            ? `rgba(${r},${g},${b},0.5)`
            : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        roundRect(ctx, iconX + 0.5, iconY + 0.5, iconSize - 1, iconSize - 1, 3);
        ctx.stroke();

        // Icon image or fallback dot
        this.drawIcon(ctx, ability.refImage, iconX, iconY, iconSize, active, ability.color);

        // Name
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(ability.shortName, x + iconSize + 6, y + 3);

        // Value
        let valueStr: string;
        if (isStackingDisplay(ability.type)) {
            valueStr = `\u00D7${state?.stacks || 0}`;
        } else if (isTimerDisplay(ability.type)) {
            valueStr = active ? formatTimeShort(state?.time || 0) : '\u2014';
        } else {
            valueStr = active ? formatTimeShort(state?.time || 0) : '\u2014';
        }

        ctx.font = '500 10px Consolas, "SF Mono", monospace';
        ctx.fillStyle = active ? ability.color : 'rgba(255,255,255,0.25)';
        ctx.textBaseline = 'bottom';
        ctx.fillText(valueStr, x + iconSize + 6, y + h - 2);

        ctx.globalAlpha = 1.0;
    }

    // =====================================================================
    // Icon drawing helper
    // =====================================================================

    /** Draw an ability/conjure icon - uses display image first, falls back to ref image, then colored dot. */
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
        if (!def) return { width: 340, height: 60 };

        const width = 340;
        const padX = 12;
        const pillW = 72;
        const pillH = 26;
        const pillGap = 4;
        const maxPerRow = Math.floor((width - padX * 2 + pillGap) / (pillW + pillGap));

        let height = 8; // top padding

        // Ability pills (only abilities not in dedicated sections)
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const dedicatedIds = new Set([...GAUGE_EXCLUDED_IDS, ...conjureIds, 'bloat']);
        const abilityCount = def.abilities.filter(a => !dedicatedIds.has(a.id)).length;
        const rows = Math.ceil(abilityCount / maxPerRow);
        height += rows * (pillH + pillGap);

        // Bloat bar + conjure pill row
        if (def.abilities.some(a => conjureIds.includes(a.id))) {
            height += 24 + 30; // bloat bar (20+4) + conjure pills (26+4)
        }

        height += 6; // bottom padding
        return { width, height };
    }
}
