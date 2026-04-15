import { OverlayRenderer, hexToRgba, hexToRgb, formatTimeShort, roundRect } from '../renderer';
import { AppState, AbilityState } from '../store';
import { StyleDef, AbilityDef, isTimerDisplay, isStackingDisplay } from '../../data/abilities';
import { COMBAT_STYLES } from '../../data/abilities';
import { getRefImages, getDisplayImages } from '../../data/icon-loader';

// Abilities that are tracked (matched + consume slots) but never rendered in the gauge.
const GAUGE_EXCLUDED_IDS = new Set(['death_spark', 'death_essence_buff', 'death_essence_debuff', 'bone_shield']);

/**
 * Classic Grid renderer (Style B).
 * Grid of bordered icon squares with overlaid timers, resembling the in-game buff bar.
 * Progress bars for stack abilities. Familiar RS3 aesthetic.
 */
export class ClassicRenderer implements OverlayRenderer {
    private _showBg: boolean = true;

    // =====================================================================
    // HTML Rendering
    // =====================================================================

    renderToHTML(container: HTMLElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        let html = '';

        // Icon grid (timer + toggle abilities), excluding gauge-excluded IDs and conjures
        const gridExcludeConjures = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const gridAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id) && !gridExcludeConjures.includes(a.id) && a.id !== 'bloat');
        html += '<div class="classic-grid">';
        for (const ability of gridAbilities) {
            const abilityState = state.abilities[ability.id];
            html += this.renderIconCellHTML(ability, abilityState);
        }
        html += '</div>';

        // Stack abilities as progress bars, excluding gauge-excluded IDs
        const stackAbilities = def.abilities.filter(a => isStackingDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id));
        if (stackAbilities.length > 0) {
            html += '<div class="classic-stacks">';
            for (const ability of stackAbilities) {
                const abilityState = state.abilities[ability.id];
                html += this.renderStackBarHTML(ability, abilityState);
            }
            html += '</div>';
        }

        // Bloat progress bar (enemy-debuff with internalDuration - not caught by isTimerDisplay)
        const bloat = def.abilities.find(a => a.id === 'bloat');
        if (bloat) {
            const bloatState = state.abilities['bloat'];
            html += '<div class="classic-stacks">';
            html += this.renderBloatBarHTML(bloat, bloatState);
            html += '</div>';
        }

        // Conjure pills at bottom
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjures = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjures.length > 0) {
            html += '<div class="classic-conjure-row">';
            for (const conjure of conjures) {
                const active = state.abilities[conjure.id]?.active || false;
                const bgColor = active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)';
                const borderColor = active ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)';
                const dotColor = active ? '#22c55e' : 'rgba(255,255,255,0.15)';
                const textColor = active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
                html += `
                    <div class="classic-conjure-pill" style="background: ${bgColor}; border: 1px solid ${borderColor};">
                        <span class="classic-conjure-pill-dot" style="background: ${dotColor};"></span>
                        <span style="color: ${textColor};">${conjure.shortName}</span>
                    </div>
                `;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    private renderIconCellHTML(ability: AbilityDef, state: AbilityState | null): string {
        const active = state?.active || false;
        const opacity = active ? '1' : '0.4';
        const borderColor = active
            ? hexToRgba(ability.color, 0.6)
            : 'rgba(255,255,255,0.08)';
        const iconColor = active ? ability.color : 'rgba(255,255,255,0.2)';

        let timerHtml = '';
        if (active && isTimerDisplay(ability.type)) {
            const timeStr = formatTimeShort(state?.time || 0);
            timerHtml = `<div class="classic-timer-overlay">${timeStr}</div>`;
        } else if (active && isTimerDisplay(ability.type)) {
            timerHtml = `<div class="classic-timer-overlay" style="background: rgba(34,197,94,0.7);">ON</div>`;
        }

        return `
            <div class="classic-cell" style="opacity: ${opacity};">
                <div class="classic-icon" style="border-color: ${borderColor};">
                    <span class="classic-icon-symbol" style="color: ${iconColor};">\u25CF</span>
                    ${timerHtml}
                </div>
                <div class="classic-label">${ability.shortName}</div>
            </div>
        `;
    }

    private renderStackBarHTML(ability: AbilityDef, state: AbilityState | null): string {
        const stacks = state?.stacks || 0;
        const max = ability.maxStacks || 1;
        const pct = Math.min((stacks / max) * 100, 100);
        const [r, g, b] = hexToRgb(ability.color);

        return `
            <div class="classic-stack-bar">
                <div class="classic-stack-bar-header">
                    <span class="classic-stack-bar-label">${ability.shortName}</span>
                    <span class="classic-stack-bar-count" style="color: ${stacks > 0 ? ability.color : 'rgba(255,255,255,0.3)'};">${stacks} / ${max}</span>
                </div>
                <div class="classic-stack-bar-track">
                    <div class="classic-stack-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, ${ability.color}, ${hexToRgba(ability.color, 0.6)});"></div>
                </div>
            </div>
        `;
    }

    private renderBloatBarHTML(ability: AbilityDef, state: AbilityState | null): string {
        const active = state?.active || false;
        const time = state?.time || 0;
        const maxTime = ability.internalDuration || 20.5;
        const pct = active ? Math.min((time / maxTime) * 100, 100) : 0;

        return `
            <div class="classic-stack-bar">
                <div class="classic-stack-bar-header">
                    <span class="classic-stack-bar-label">${ability.shortName}</span>
                    <span class="classic-stack-bar-count" style="color: ${active ? ability.color : 'rgba(255,255,255,0.3)'};">${active ? formatTimeShort(time) : '\u2014'}</span>
                </div>
                <div class="classic-stack-bar-track">
                    <div class="classic-stack-bar-fill" style="width: ${pct}%; background: linear-gradient(90deg, ${ability.color}, ${hexToRgba(ability.color, 0.6)});"></div>
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

        this._showBg = state.combatGaugeBackgroundVisible;
        const scale = state.overlayScale || 1.0;
        const dims = this.getMinDimensions(state, def);
        canvas.width = Math.round(dims.width * scale);
        canvas.height = Math.round(dims.height * scale);

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(scale, scale);

        const [sr, sg, sb] = hexToRgb(def.color);

        if (this._showBg) {
            // Background gradient (approximation - canvas can't do CSS gradients easily)
            ctx.fillStyle = 'rgba(18, 12, 30, 235)'; // 0.92 * 255
            roundRect(ctx, 0, 0, dims.width, dims.height, 4);
            ctx.fill();

            // Border
            ctx.strokeStyle = `rgba(${sr},${sg},${sb},0.4)`;
            ctx.lineWidth = 1;
            roundRect(ctx, 0.5, 0.5, dims.width - 1, dims.height - 1, 4);
            ctx.stroke();
        }

        const padX = 8;
        let y = 6;

        // Icon grid - 4 columns (excluding gauge-excluded IDs and conjures)
        const gridExcludeConjures = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const gridAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id) && !gridExcludeConjures.includes(a.id) && a.id !== 'bloat');
        const cols = 4;
        const cellW = 36;
        const cellGap = 4;
        const labelH = 12;
        const totalGridW = cols * cellW + (cols - 1) * cellGap;
        const gridStartX = padX + (dims.width - padX * 2 - totalGridW) / 2;

        // Necromancy grouping: Row 1 = ultimates (2), Row 2 = incantations (4)
        // Other styles: keep original 4-column flow
        const ultimateIds = ['living_death', 'death_skulls'];
        const incantationIds = ['invoke_death', 'threads', 'darkness', 'split_soul_necro'];
        const isNecro = def.id === 'necromancy';

        if (isNecro) {
            const contentW = dims.width - padX * 2;

            // Row 1: Ultimates (2 icons, spread across full width)
            const ultimates = def.abilities.filter(a => ultimateIds.includes(a.id));
            if (ultimates.length > 0) {
                const ultCellW = 48;
                const ultGap = Math.max(8, (contentW - ultimates.length * ultCellW) / (ultimates.length + 1));
                let ux = padX + ultGap;
                for (const ability of ultimates) {
                    const abilityState = state.abilities[ability.id];
                    this.drawIconCell(ctx, ability, abilityState, ux, y, ultCellW);
                    ux += ultCellW + ultGap;
                }
                y += ultCellW + labelH + cellGap;
            }

            // Row 2: Incantations (4 icons, spread across full width)
            const incantations = def.abilities.filter(a => incantationIds.includes(a.id));
            if (incantations.length > 0) {
                const incCols = incantations.length;
                const incCellW = 36;
                const incGap = Math.max(4, (contentW - incCols * incCellW) / (incCols + 1));
                let ix = padX + incGap;
                for (const ability of incantations) {
                    const abilityState = state.abilities[ability.id];
                    this.drawIconCell(ctx, ability, abilityState, ix, y, incCellW);
                    ix += incCellW + incGap;
                }
                y += incCellW + labelH + cellGap;
            }
        } else {
            // Non-necromancy: original 4-column flow
            let gx = gridStartX;
            let col = 0;
            for (const ability of gridAbilities) {
                const abilityState = state.abilities[ability.id];
                this.drawIconCell(ctx, ability, abilityState, gx, y, cellW);
                col++;
                gx += cellW + cellGap;
                if (col >= cols) {
                    col = 0;
                    gx = gridStartX;
                    y += cellW + labelH + cellGap;
                }
            }
            if (col > 0) y += cellW + labelH + cellGap;
        }

        // Stack progress bars (excluding gauge-excluded IDs)
        const stackAbilities = def.abilities.filter(a => isStackingDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id));
        if (stackAbilities.length > 0) {
            y += 2;
            const barGap = 6;
            const barW = (dims.width - padX * 2 - barGap * (stackAbilities.length - 1)) / stackAbilities.length;

            let bx = padX;
            for (const ability of stackAbilities) {
                const abilityState = state.abilities[ability.id];
                this.drawStackBar(ctx, ability, abilityState, bx, y, barW);
                bx += barW + barGap;
            }
            y += 26;
        }

        // Bloat progress bar (enemy-debuff, not caught by isTimerDisplay)
        const bloat = def.abilities.find(a => a.id === 'bloat');
        if (bloat) {
            y += 2;
            const bloatState = state.abilities['bloat'];
            this.drawBloatBar(ctx, bloat, bloatState, padX, y, dims.width - padX * 2);
            y += 26;
        }

        // Conjure pills at bottom
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjureAbilities = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            y += 4;
            const pillGap = 4;
            const pillW = (dims.width - padX * 2 - pillGap * (conjureAbilities.length - 1)) / conjureAbilities.length;
            const pillH = 18;
            let cx = padX;

            for (const conjure of conjureAbilities) {
                const active = state.abilities[conjure.id]?.active || false;

                if (this._showBg) {
                    // Pill background
                    ctx.fillStyle = active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)';
                    roundRect(ctx, cx, y, pillW, pillH, 3);
                    ctx.fill();

                    // Pill border
                    ctx.strokeStyle = active ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)';
                    ctx.lineWidth = 1;
                    roundRect(ctx, cx + 0.5, y + 0.5, pillW - 1, pillH - 1, 3);
                    ctx.stroke();
                }

                // Conjure icon or fallback dot
                const iconSize = 14;
                this.drawIcon(ctx, conjure.refImage, cx + 3, y + (pillH - iconSize) / 2, iconSize, active, '#22c55e');

                if (this._showBg) {
                    // Name
                    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
                    ctx.fillStyle = active ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(conjure.shortName, cx + 20, y + pillH / 2);
                }

                cx += pillW + pillGap;
            }
            y += pillH;
        }

        ctx.restore();
    }

    private drawIconCell(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AbilityState | null,
        x: number, y: number,
        size: number,
    ): void {
        const active = state?.active || false;
        const [r, g, b] = hexToRgb(ability.color);

        ctx.globalAlpha = active ? 1.0 : 0.4;

        if (this._showBg) {
            // Icon background
            ctx.fillStyle = 'rgba(30, 20, 50, 204)'; // 0.8 * 255
            roundRect(ctx, x, y, size, size, 2);
            ctx.fill();

            // Icon border
            ctx.strokeStyle = active
                ? `rgba(${r},${g},${b},0.6)`
                : 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, 2);
            ctx.stroke();
        }

        this.drawIcon(ctx, ability.refImage, x, y, size, active, ability.color);

        // Timer text, outlined in minimal mode for contrast against the game.
        if (active) {
            const text = formatTimeShort(state?.time || 0);
            ctx.font = '500 9px Consolas, "SF Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const textX = x + size / 2;
            const textY = y + size - 6;
            if (!this._showBg) {
                ctx.strokeStyle = 'rgba(0,0,0,0.85)';
                ctx.lineWidth = 2;
                ctx.strokeText(text, textX, textY);
            }
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, textX, textY);
        }

        if (this._showBg) {
            // Label below
            ctx.font = '9px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.shortName, x + size / 2, y + size + 2);
        }

        ctx.globalAlpha = 1.0;
    }

    private drawStackBar(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AbilityState | null,
        x: number, y: number,
        w: number,
    ): void {
        const stacks = state?.stacks || 0;
        const max = ability.maxStacks || 1;
        const pct = Math.min(stacks / max, 1);

        if (this._showBg) {
            // Label
            ctx.font = '10px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.shortName, x, y);
        }

        // Count
        ctx.font = '500 10px Consolas, "SF Mono", monospace';
        ctx.fillStyle = stacks > 0 ? ability.color : 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(`${stacks} / ${max}`, x + w, y);

        // Progress bar track
        const barY = y + 14;
        const barH = 6;
        if (this._showBg) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            roundRect(ctx, x, barY, w, barH, 3);
            ctx.fill();
        }

        // Progress bar fill
        if (pct > 0) {
            const fillW = Math.max(w * pct, barH); // min width = height for rounded ends
            ctx.fillStyle = ability.color;
            roundRect(ctx, x, barY, fillW, barH, 3);
            ctx.fill();
        }
    }

    private drawBloatBar(
        ctx: CanvasRenderingContext2D,
        ability: AbilityDef,
        state: AbilityState | null,
        x: number, y: number,
        w: number,
    ): void {
        const active = state?.active || false;
        const time = state?.time || 0;
        const maxTime = ability.internalDuration || 20.5;
        const pct = active ? Math.min(time / maxTime, 1) : 0;

        const iconSize = 14;
        this.drawIcon(ctx, ability.refImage, x, y, iconSize, active, ability.color);

        if (this._showBg) {
            // Label
            ctx.font = '10px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(ability.shortName, x + iconSize + 4, y);
        }

        // Timer value
        ctx.font = '500 10px Consolas, "SF Mono", monospace';
        ctx.fillStyle = active ? ability.color : 'rgba(255,255,255,0.3)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(active ? formatTimeShort(time) : '\u2014', x + w, y);

        // Progress bar track
        const barY = y + 14;
        const barH = 6;
        if (this._showBg) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            roundRect(ctx, x, barY, w, barH, 3);
            ctx.fill();
        }

        // Progress bar fill
        if (pct > 0) {
            const fillW = Math.max(w * pct, barH);
            ctx.fillStyle = ability.color;
            roundRect(ctx, x, barY, fillW, barH, 3);
            ctx.fill();
        }
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
        if (!def) return { width: 360, height: 120 };

        const width = 360;
        let height = 6; // top padding

        // Grid (excluding gauge-excluded IDs and conjures)
        const gridExcludeConjures = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const gridAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id) && !gridExcludeConjures.includes(a.id) && a.id !== 'bloat');
        const cols = 4;
        const cellW = 36;
        const cellGap = 4;
        const labelH = 12;
        const rows = Math.ceil(gridAbilities.length / cols);
        height += rows * (cellW + labelH + cellGap);

        // Necromancy uses 2 explicit rows regardless of count
        if (def.id === 'necromancy') {
            height = 6; // reset from top
            height += (48 + labelH + cellGap); // ultimates row (larger icons)
            height += (cellW + labelH + cellGap); // incantations row
        }

        // Stack bars (excluding gauge-excluded IDs)
        const stackCount = def.abilities.filter(a => isStackingDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id)).length;
        if (stackCount > 0) {
            height += 2 + 26; // gap + bar section
        }

        // Bloat bar
        const hasBloat = def.abilities.some(a => a.id === 'bloat');
        if (hasBloat) {
            height += 2 + 26; // gap + bar section
        }

        // Conjure pills
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        if (def.abilities.some(a => conjureIds.includes(a.id))) {
            height += 4 + 18; // gap + pill row
        }

        height += 8; // bottom padding
        return { width, height };
    }
}
