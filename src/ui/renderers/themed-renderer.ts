import { OverlayRenderer, hexToRgba, hexToRgb, formatTimeShort, roundRect } from '../renderer';
import { AppState, AbilityState } from '../store';
import { StyleDef, AbilityDef, CombatStyle, isTimerDisplay, isStackingDisplay } from '../../data/abilities';
import { COMBAT_STYLES } from '../../data/abilities';
import { getRefImages, getDisplayImages } from '../../data/icon-loader';

// Abilities that are tracked (matched + consume slots) but never rendered in the gauge.
const GAUGE_EXCLUDED_IDS = new Set(['death_spark', 'death_essence_buff', 'death_essence_debuff', 'bone_shield']);

/**
 * Themed renderer (Style D).
 * FFXIV job gauge inspired - each combat style has a bespoke visual where the shape is the identity.
 * - Necromancy: Plague doctor mask silhouette with glowing eyes
 * - Magic: Arcane staff with sun orb and runic circle segments
 * - Ranged: Crosshair target with angular hex frames and arrowhead stacks
 * - Melee: Shield/diamond crest with bleed progress bars
 */
export class ThemedRenderer implements OverlayRenderer {

    // =====================================================================
    // HTML Rendering - falls back to canvas in an <img> tag
    // =====================================================================

    renderToHTML(container: HTMLElement, state: AppState, styleDef?: StyleDef): void {
        const def = styleDef || COMBAT_STYLES.find(s => s.id === state.combatStyle);
        if (!def) return;

        // Render to canvas, then show as image in HTML
        const canvas = document.createElement('canvas');
        this.renderToCanvas(canvas, state, def);

        container.innerHTML = '';
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        container.appendChild(canvas);
    }

    // =====================================================================
    // Canvas Rendering - dispatches to per-style methods
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

        switch (def.id as CombatStyle) {
            case 'necromancy':
                this.drawNecromancy(ctx, state, def, dims.width, dims.height);
                break;
            case 'magic':
                this.drawMagic(ctx, state, def, dims.width, dims.height);
                break;
            case 'ranged':
                this.drawRanged(ctx, state, def, dims.width, dims.height);
                break;
            case 'melee':
                this.drawMelee(ctx, state, def, dims.width, dims.height);
                break;
        }

        ctx.restore();
    }

    // =====================================================================
    // Necromancy - Plague Doctor Mask
    // =====================================================================

    private drawNecromancy(ctx: CanvasRenderingContext2D, state: AppState, def: StyleDef, w: number, h: number): void {
        const cx = w / 2;

        // Background
        ctx.fillStyle = 'rgba(8, 5, 14, 247)';
        roundRect(ctx, 0, 0, w, h, 6);
        ctx.fill();

        // Mask silhouette
        ctx.beginPath();
        ctx.moveTo(cx - 45, 18);
        ctx.lineTo(cx - 30, 6);
        ctx.lineTo(cx, 2);
        ctx.lineTo(cx + 30, 6);
        ctx.lineTo(cx + 45, 18);
        ctx.lineTo(cx + 50, 40);
        ctx.lineTo(cx + 52, 55);
        ctx.lineTo(cx + 48, 70);
        ctx.lineTo(cx + 42, 85);
        ctx.lineTo(cx + 34, 100);
        ctx.lineTo(cx + 25, 112);
        ctx.lineTo(cx + 10, 140);
        ctx.lineTo(cx, 150);
        ctx.lineTo(cx - 10, 140);
        ctx.lineTo(cx - 25, 112);
        ctx.lineTo(cx - 34, 100);
        ctx.lineTo(cx - 42, 85);
        ctx.lineTo(cx - 48, 70);
        ctx.lineTo(cx - 52, 55);
        ctx.lineTo(cx - 50, 40);
        ctx.closePath();
        ctx.fillStyle = 'rgba(8, 5, 14, 0.97)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Eyes
        const eyeGlow = this.getAbilityActive(state, 'living_death') ? 0.7 : 0.2;
        this.drawMaskEye(ctx, cx - 22, 48, eyeGlow);
        this.drawMaskEye(ctx, cx + 22, 48, eyeGlow);

        // Nose ridge
        ctx.beginPath();
        ctx.moveTo(cx - 2, 66);
        ctx.lineTo(cx, 68);
        ctx.lineTo(cx + 2, 66);
        ctx.lineTo(cx + 1, 80);
        ctx.lineTo(cx, 110);
        ctx.lineTo(cx - 1, 80);
        ctx.closePath();
        ctx.fillStyle = 'rgba(15, 10, 22, 0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.2)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Living Death timer below mask chin
        const ldState = state.abilities['living_death'];
        const ldActive = ldState?.active || false;
        const ldTime = ldActive ? formatTimeShort(ldState?.time || 0) : '\u2014';
        ctx.font = '500 13px Consolas, "SF Mono", monospace';
        ctx.fillStyle = ldActive ? 'rgba(192, 132, 252, 0.8)' : 'rgba(192, 132, 252, 0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ldTime, cx, 158);

        ctx.font = '6px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(192, 132, 252, 0.3)';
        ctx.fillText('LIVING DEATH', cx, 168);

        // Necrosis bar below
        const necrosisState = state.abilities['necrosis'];
        const necrosisStacks = necrosisState?.stacks || 0;
        const necrosisMax = 12;
        const barX = cx - 40;
        const barY = 178;
        const barW = 80;
        const barH = 10;

        ctx.fillStyle = 'rgba(5, 2, 10, 0.98)';
        roundRect(ctx, barX, barY, barW, barH, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.lineWidth = 0.8;
        roundRect(ctx, barX, barY, barW, barH, 2);
        ctx.stroke();

        const fillW = (necrosisStacks / necrosisMax) * (barW - 2);
        if (fillW > 0) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
            roundRect(ctx, barX + 1, barY + 1, fillW, barH - 2, 1.5);
            ctx.fill();
        }

        ctx.font = '500 7px Consolas, monospace';
        ctx.fillStyle = 'rgba(252, 165, 165, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${necrosisStacks} / ${necrosisMax}`, cx, barY + barH / 2);

        ctx.font = '6px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.fillText('NECROSIS', cx, barY + barH + 10);

        // Souls cascade (left side)
        const soulsState = state.abilities['souls'];
        const soulsStacks = soulsState?.stacks || 0;
        const soulsMax = 5;

        for (let i = 0; i < soulsMax; i++) {
            const filled = i < soulsStacks;
            const sy = 70 + i * 25;
            const sx = 30 - i * 2;

            ctx.beginPath();
            ctx.arc(sx, sy, 9, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(4, 2, 8, 0.95)';
            ctx.fill();
            ctx.strokeStyle = filled ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.12)';
            ctx.lineWidth = 0.8;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, Math.PI * 2);
            ctx.fillStyle = filled ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.1)';
            ctx.fill();
        }

        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = 'rgba(34, 197, 94, 0.4)';
        ctx.textAlign = 'center';
        ctx.fillText(`${soulsStacks} / ${soulsMax}`, 26, soulsMax * 25 + 80);
        ctx.font = '6px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
        ctx.fillText('SOULS', 26, soulsMax * 25 + 90);

        // Conjures (right side)
        const conjureIds = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const conjureAbilities = def.abilities.filter(a => conjureIds.includes(a.id));
        if (conjureAbilities.length > 0) {
            for (let i = 0; i < conjureAbilities.length; i++) {
                const conjure = conjureAbilities[i];
                const active = state.abilities[conjure.id]?.active || false;
                const cy = 70 + i * 25;
                const cxr = w - 30 + i * 2;
                const iconSize = 18;

                ctx.beginPath();
                ctx.arc(cxr, cy, 9, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(4, 2, 8, 0.95)';
                ctx.fill();
                ctx.strokeStyle = active ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.12)';
                ctx.lineWidth = 0.8;
                ctx.stroke();

                // Conjure icon or fallback dot
                this.drawIcon(ctx, conjure.refImage, cxr - iconSize / 2, cy - iconSize / 2, iconSize, active, '#22c55e');

                ctx.font = '7px "Segoe UI", sans-serif';
                ctx.fillStyle = active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)';
                ctx.textAlign = 'center';
                ctx.fillText(conjure.shortName, cxr, cy + 16);
            }
        }

        // Other timer abilities along the sides (excluding gauge-excluded IDs and conjures)
        const conjureIdsFilter = ['skeleton', 'zombie', 'ghost', 'phantom'];
        const timerAbilities = def.abilities.filter(a =>
            isTimerDisplay(a.type) && a.id !== 'living_death' && !GAUGE_EXCLUDED_IDS.has(a.id) && !conjureIdsFilter.includes(a.id)
        );
        const leftTimers = timerAbilities.slice(0, Math.ceil(timerAbilities.length / 2));
        const rightTimers = timerAbilities.slice(Math.ceil(timerAbilities.length / 2));

        this.drawSideTimers(ctx, leftTimers, state, 10, 210, 'left');
        this.drawSideTimers(ctx, rightTimers, state, w - 10, 210, 'right');

        // Bloat progress bar below side timers
        const bloat = def.abilities.find(a => a.id === 'bloat');
        if (bloat) {
            const bloatState = state.abilities['bloat'];
            this.drawBloatBar(ctx, bloat, bloatState, 30, 240, w - 60);
        }
    }

    private drawMaskEye(ctx: CanvasRenderingContext2D, x: number, y: number, glow: number): void {
        // Eye socket
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 4);
        ctx.lineTo(x - 5, y - 8);
        ctx.lineTo(x + 8, y);
        ctx.lineTo(x + 8, y + 10);
        ctx.lineTo(x - 2, y + 14);
        ctx.lineTo(x - 8, y + 10);
        ctx.lineTo(x - 12, y + 4);
        ctx.closePath();
        ctx.fillStyle = 'rgba(4, 2, 8, 0.98)';
        ctx.fill();
        ctx.strokeStyle = `rgba(34, 197, 94, 0.45)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Inner glow
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x, y - 3);
        ctx.lineTo(x + 5, y + 1);
        ctx.lineTo(x + 4, y + 5);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 4, y + 3);
        ctx.closePath();
        ctx.fillStyle = `rgba(34, 197, 94, ${glow})`;
        ctx.fill();

        // Bright pupil
        ctx.beginPath();
        ctx.moveTo(x - 1, y + 1);
        ctx.lineTo(x + 2, y);
        ctx.lineTo(x + 3, y + 3);
        ctx.lineTo(x + 1, y + 4);
        ctx.lineTo(x - 1, y + 3);
        ctx.closePath();
        ctx.fillStyle = glow > 0.5 ? '#22c55e' : `rgba(34, 197, 94, ${glow * 0.7})`;
        ctx.fill();
    }

    // =====================================================================
    // Magic - Arcane Staff with Runic Circle
    // =====================================================================

    private drawMagic(ctx: CanvasRenderingContext2D, state: AppState, def: StyleDef, w: number, h: number): void {
        const cx = w / 2;

        // Background
        ctx.fillStyle = 'rgba(6, 4, 16, 235)';
        roundRect(ctx, 0, 0, w, h, 6);
        ctx.fill();

        // Staff spine
        ctx.strokeStyle = 'rgba(120, 100, 60, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, 30);
        ctx.lineTo(cx, h - 30);
        ctx.stroke();

        // Sun orb at top (Sunshine)
        const sunState = state.abilities['sunshine'] || state.abilities['greater_sunshine'];
        const sunActive = sunState?.active || false;
        const sunGlow = sunActive ? 0.5 : 0.15;

        ctx.beginPath();
        ctx.arc(cx, 30, 22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 10, 5, 0.9)';
        ctx.fill();
        ctx.strokeStyle = `rgba(251, 191, 36, ${sunActive ? 0.5 : 0.2})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, 30, 14, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(251, 191, 36, ${sunGlow})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cx, 30, 8, 0, Math.PI * 2);
        ctx.fillStyle = sunActive ? '#fbbf24' : 'rgba(251, 191, 36, 0.2)';
        ctx.fill();

        // Sunshine timer
        ctx.font = '500 12px Consolas, "SF Mono", monospace';
        ctx.fillStyle = sunActive ? '#fbbf24' : 'rgba(251, 191, 36, 0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sunActive ? formatTimeShort(sunState?.time || 0) : '\u2014', cx, 58);
        ctx.font = '7px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
        ctx.fillText('SUNSHINE', cx, 68);

        // Runic circle
        const circleY = 140;
        const circleR = 50;
        ctx.beginPath();
        ctx.arc(cx, circleY, circleR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10, 8, 20, 0.6)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arc segments for timer abilities (exclude sunshine which is the orb, and gauge-excluded IDs)
        const arcAbilities = def.abilities.filter(a =>
            isTimerDisplay(a.type) && a.id !== 'sunshine' && a.id !== 'greater_sunshine' && !GAUGE_EXCLUDED_IDS.has(a.id)
        );

        const arcCount = arcAbilities.length;
        const arcSpan = Math.PI / (arcCount || 1);

        for (let i = 0; i < arcAbilities.length; i++) {
            const ability = arcAbilities[i];
            const abilityState = state.abilities[ability.id];
            const active = abilityState?.active || false;
            const startAngle = -Math.PI / 2 + i * arcSpan;
            const endAngle = startAngle + arcSpan - 0.05;
            const [r, g, b] = hexToRgb(ability.color);

            ctx.beginPath();
            ctx.arc(cx, circleY, circleR, startAngle, endAngle);
            ctx.strokeStyle = active ? ability.color : `rgba(${r},${g},${b},0.15)`;
            ctx.lineWidth = active ? 4 : 2;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Label at arc midpoint
            const midAngle = (startAngle + endAngle) / 2;
            const labelR = circleR + 16;
            const lx = cx + Math.cos(midAngle) * labelR;
            const ly = circleY + Math.sin(midAngle) * labelR;

            ctx.font = '500 9px Consolas, monospace';
            ctx.fillStyle = active ? ability.color : `rgba(${r},${g},${b},0.3)`;
            ctx.textAlign = midAngle > Math.PI / 2 ? 'right' : 'left';
            ctx.textBaseline = 'middle';

            const timeStr = active ? formatTimeShort(abilityState?.time || 0) : '\u2014';
            ctx.fillText(`${timeStr} ${ability.shortName}`, lx, ly);
        }

        // Toggle abilities as medallions on sides (excluding gauge-excluded IDs)
        const toggleAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id));
        for (let i = 0; i < toggleAbilities.length; i++) {
            const ability = toggleAbilities[i];
            const abilityState = state.abilities[ability.id];
            const active = abilityState?.active || false;
            const mx = i === 0 ? 50 : w - 50;
            const my = circleY;
            const [r, g, b] = hexToRgb(ability.color);

            ctx.beginPath();
            ctx.arc(mx, my, 20, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(10, 5, 5, 0.9)';
            ctx.fill();
            ctx.strokeStyle = active ? `rgba(${r},${g},${b},0.4)` : `rgba(${r},${g},${b},0.12)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Ability icon or fallback circle
            const iconSize = 20;
            this.drawIcon(ctx, ability.refImage, mx - iconSize / 2, my - iconSize / 2, iconSize, active, ability.color);

            ctx.font = '7px "Segoe UI", sans-serif';
            ctx.fillStyle = active ? `rgba(${r},${g},${b},0.8)` : `rgba(${r},${g},${b},0.3)`;
            ctx.textAlign = 'center';
            ctx.fillText(active ? `${ability.shortName} Active` : ability.shortName, mx, my + 28);
        }

        // Stack abilities (Blood Tithe count etc) below circle
        const stackAbilities = def.abilities.filter(a => isStackingDisplay(a.type));
        if (stackAbilities.length > 0) {
            let sy = circleY + circleR + 30;
            for (const ability of stackAbilities) {
                const abilityState = state.abilities[ability.id];
                const stacks = abilityState?.stacks || 0;
                ctx.font = '500 11px Consolas, monospace';
                ctx.fillStyle = stacks > 0 ? ability.color : hexToRgba(ability.color, 0.2);
                ctx.textAlign = 'center';
                ctx.fillText(`${ability.shortName}: ${stacks}`, cx, sy);
                sy += 16;
            }
        }
    }

    // =====================================================================
    // Ranged - Crosshair Target
    // =====================================================================

    private drawRanged(ctx: CanvasRenderingContext2D, state: AppState, def: StyleDef, w: number, h: number): void {
        const cx = w / 2;
        const cy = 100;

        // Background
        ctx.fillStyle = 'rgba(4, 8, 4, 235)';
        roundRect(ctx, 0, 0, w, h, 6);
        ctx.fill();

        // Crosshair rings
        const rings = [60, 40, 20];
        for (const r of rings) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(163, 230, 53, ${0.08 + (60 - r) * 0.003})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Crosshair lines
        ctx.strokeStyle = 'rgba(163, 230, 53, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 70, cy);
        ctx.lineTo(cx + 70, cy);
        ctx.moveTo(cx, cy - 70);
        ctx.lineTo(cx, cy + 70);
        ctx.stroke();

        // Center dot (DS active = bright)
        const dsState = state.abilities['deaths_swiftness'] || state.abilities['greater_deaths_swiftness'];
        const dsActive = dsState?.active || false;

        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = dsActive ? '#a3e635' : 'rgba(163, 230, 53, 0.2)';
        ctx.fill();

        // DS timer in center
        ctx.font = '500 13px Consolas, "SF Mono", monospace';
        ctx.fillStyle = dsActive ? '#a3e635' : 'rgba(163, 230, 53, 0.2)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dsActive ? formatTimeShort(dsState?.time || 0) : '\u2014', cx, cy + 20);
        ctx.font = '7px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(163, 230, 53, 0.4)';
        ctx.fillText("DEATH'S SWIFTNESS", cx, cy + 30);

        // Timer abilities placed at compass points around crosshair (excluding gauge-excluded IDs)
        const timerAbilities = def.abilities.filter(a =>
            isTimerDisplay(a.type) && a.id !== 'deaths_swiftness' && a.id !== 'greater_deaths_swiftness' && !GAUGE_EXCLUDED_IDS.has(a.id)
        );

        const positions = [
            { angle: -Math.PI / 4, r: 55 },       // NE
            { angle: Math.PI / 4, r: 55 },         // SE
            { angle: 3 * Math.PI / 4, r: 55 },     // SW
            { angle: -3 * Math.PI / 4, r: 55 },    // NW
            { angle: 0, r: 65 },                     // E
            { angle: Math.PI, r: 65 },               // W
        ];

        for (let i = 0; i < timerAbilities.length && i < positions.length; i++) {
            const ability = timerAbilities[i];
            const abilityState = state.abilities[ability.id];
            const active = abilityState?.active || false;
            const pos = positions[i];
            const px = cx + Math.cos(pos.angle) * pos.r;
            const py = cy + Math.sin(pos.angle) * pos.r;
            const [r, g, b] = hexToRgb(ability.color);

            // Angular hex frame (sharp corners) with icon
            ctx.save();
            ctx.translate(px, py);
            this.drawHexFrame(ctx, 0, 0, 14, active ? ability.color : `rgba(${r},${g},${b},0.15)`);
            ctx.restore();
            // Ability icon inside hex
            const hexIconSize = 18;
            this.drawIcon(ctx, ability.refImage, px - hexIconSize / 2, py - hexIconSize / 2, hexIconSize, active, ability.color);

            // Timer label
            const labelOffset = pos.angle > -Math.PI / 2 && pos.angle < Math.PI / 2 ? 20 : -20;
            ctx.font = '500 8px Consolas, monospace';
            ctx.fillStyle = active ? ability.color : `rgba(${r},${g},${b},0.3)`;
            ctx.textAlign = labelOffset > 0 ? 'left' : 'right';
            ctx.textBaseline = 'middle';
            const timeStr = active ? formatTimeShort(abilityState?.time || 0) : '\u2014';
            ctx.fillText(`${timeStr}`, px + labelOffset, py);
            ctx.font = '6px "Segoe UI", sans-serif';
            ctx.fillText(ability.shortName, px + labelOffset, py + 10);
        }

        // P.Eq arrowhead stacks (quiver row)
        const peqState = state.abilities['perfect_equilibrium'];
        const peqStacks = peqState?.stacks || 0;
        const peqMax = 8;
        const arrowY = 180;

        ctx.font = '7px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(244, 114, 182, 0.4)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PERFECT EQUILIBRIUM', cx, arrowY - 10);

        const arrowW = 10;
        const arrowH = 18;
        const totalArrowW = peqMax * arrowW + (peqMax - 1) * 3;
        let ax = cx - totalArrowW / 2;

        for (let i = 0; i < peqMax; i++) {
            const filled = i < peqStacks;
            this.drawArrowhead(ctx, ax + arrowW / 2, arrowY + arrowH / 2, arrowW, arrowH, filled);
            ax += arrowW + 3;
        }

        ctx.font = '500 10px Consolas, monospace';
        ctx.fillStyle = peqStacks > 0 ? '#f472b6' : 'rgba(244, 114, 182, 0.2)';
        ctx.textAlign = 'center';
        ctx.fillText(`${peqStacks}`, cx, arrowY + arrowH + 10);

        // Toggle abilities at bottom (excluding gauge-excluded IDs)
        const toggleAbilities = def.abilities.filter(a => isTimerDisplay(a.type) && !GAUGE_EXCLUDED_IDS.has(a.id));
        if (toggleAbilities.length > 0) {
            let ty = arrowY + arrowH + 26;
            for (const ability of toggleAbilities) {
                const active = state.abilities[ability.id]?.active || false;
                ctx.font = '8px "Segoe UI", sans-serif';
                ctx.fillStyle = active ? ability.color : hexToRgba(ability.color, 0.2);
                ctx.textAlign = 'center';
                ctx.fillText(`${ability.shortName}: ${active ? 'ON' : 'OFF'}`, cx, ty);
                ty += 14;
            }
        }
    }

    private drawHexFrame(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const px = x + r * Math.cos(angle);
            const py = y + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(4, 8, 4, 0.9)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    private drawArrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, filled: boolean): void {
        ctx.beginPath();
        ctx.moveTo(x, y - h / 2);           // top point
        ctx.lineTo(x + w / 2, y);            // right
        ctx.lineTo(x + w / 4, y);            // right notch
        ctx.lineTo(x + w / 4, y + h / 2);    // bottom right
        ctx.lineTo(x - w / 4, y + h / 2);    // bottom left
        ctx.lineTo(x - w / 4, y);            // left notch
        ctx.lineTo(x - w / 2, y);            // left
        ctx.closePath();

        ctx.fillStyle = filled ? '#f472b6' : 'rgba(244, 114, 182, 0.1)';
        ctx.fill();
        ctx.strokeStyle = filled ? 'rgba(244, 114, 182, 0.6)' : 'rgba(244, 114, 182, 0.15)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    // =====================================================================
    // Melee - Shield/Diamond Crest
    // =====================================================================

    private drawMelee(ctx: CanvasRenderingContext2D, state: AppState, def: StyleDef, w: number, h: number): void {
        const cx = w / 2;

        // Background
        ctx.fillStyle = 'rgba(12, 4, 4, 235)';
        roundRect(ctx, 0, 0, w, h, 6);
        ctx.fill();

        // Shield/diamond crest shape
        ctx.beginPath();
        ctx.moveTo(cx, 10);           // top
        ctx.lineTo(cx + 80, 50);      // right shoulder
        ctx.lineTo(cx + 75, 110);     // right side
        ctx.lineTo(cx, 160);          // bottom point
        ctx.lineTo(cx - 75, 110);     // left side
        ctx.lineTo(cx - 80, 50);      // left shoulder
        ctx.closePath();
        ctx.fillStyle = 'rgba(12, 4, 4, 0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Inner diamond
        ctx.beginPath();
        ctx.moveTo(cx, 30);
        ctx.lineTo(cx + 50, 60);
        ctx.lineTo(cx + 45, 100);
        ctx.lineTo(cx, 130);
        ctx.lineTo(cx - 45, 100);
        ctx.lineTo(cx - 50, 60);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Berserk timer in center
        const berserkState = state.abilities['berserk'];
        const berserkActive = berserkState?.active || false;

        ctx.font = '500 18px Consolas, "SF Mono", monospace';
        ctx.fillStyle = berserkActive ? '#ef4444' : 'rgba(239, 68, 68, 0.15)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(berserkActive ? formatTimeShort(berserkState?.time || 0) : '\u2014', cx, 70);

        ctx.font = '8px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.fillText('BERSERK', cx, 85);

        // Channel/bleed abilities as labeled progress bars below (excluding gauge-excluded IDs)
        const channelAbilities = def.abilities.filter(a =>
            isTimerDisplay(a.type) && a.id !== 'berserk' && a.id !== 'natural_instinct' && a.id !== 'greater_barge' && !GAUGE_EXCLUDED_IDS.has(a.id)
        );

        let barY = 100;
        const barW = 100;
        const barH = 14;
        const barStartX = cx - barW / 2;

        for (const ability of channelAbilities) {
            const abilityState = state.abilities[ability.id];
            const active = abilityState?.active || false;
            const time = abilityState?.time || 0;
            const [r, g, b] = hexToRgb(ability.color);

            // Progress bar track
            ctx.fillStyle = 'rgba(5, 2, 2, 0.8)';
            roundRect(ctx, barStartX, barY, barW, barH, 2);
            ctx.fill();
            ctx.strokeStyle = active ? `rgba(${r},${g},${b},0.4)` : `rgba(${r},${g},${b},0.1)`;
            ctx.lineWidth = 0.8;
            roundRect(ctx, barStartX, barY, barW, barH, 2);
            ctx.stroke();

            // Fill based on time (assuming ~10s max for visual)
            if (active && time > 0) {
                const pct = Math.min(time / 10, 1);
                const fillW = Math.max(pct * (barW - 2), barH);
                ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
                roundRect(ctx, barStartX + 1, barY + 1, fillW, barH - 2, 1.5);
                ctx.fill();
            }

            // Label + timer
            ctx.font = '500 8px "Segoe UI", sans-serif';
            ctx.fillStyle = active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(ability.shortName, barStartX + 4, barY + barH / 2);

            ctx.font = '500 8px Consolas, monospace';
            ctx.fillStyle = active ? ability.color : `rgba(${r},${g},${b},0.2)`;
            ctx.textAlign = 'right';
            ctx.fillText(active ? formatTimeShort(time) : '\u2014', barStartX + barW - 4, barY + barH / 2);

            barY += barH + 4;
        }

        // Other timer abilities (natural instinct, greater barge) as side elements (excluding gauge-excluded IDs)
        const sideAbilities = def.abilities.filter(a =>
            isTimerDisplay(a.type) && (a.id === 'natural_instinct' || a.id === 'greater_barge') && !GAUGE_EXCLUDED_IDS.has(a.id)
        );
        this.drawSideTimers(ctx, sideAbilities, state, 20, 170, 'left');
    }

    // =====================================================================
    // Shared helpers
    // =====================================================================

    private getAbilityActive(state: AppState, id: string): boolean {
        return state.abilities[id]?.active || false;
    }

    /** Draw a Bloat progress bar in the themed style */
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
        const [r, g, b] = hexToRgb(ability.color);

        // Bar background
        ctx.fillStyle = 'rgba(5, 2, 10, 0.8)';
        roundRect(ctx, x, y, w, 14, 2);
        ctx.fill();
        ctx.strokeStyle = active ? `rgba(${r},${g},${b},0.4)` : `rgba(${r},${g},${b},0.1)`;
        ctx.lineWidth = 0.8;
        roundRect(ctx, x, y, w, 14, 2);
        ctx.stroke();

        // Progress fill
        if (active && pct > 0) {
            const fillW = Math.max(pct * (w - 2), 14);
            ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
            roundRect(ctx, x + 1, y + 1, fillW, 12, 1.5);
            ctx.fill();
        }

        // Icon + label
        const iconSize = 12;
        this.drawIcon(ctx, ability.refImage, x + 3, y + 1, iconSize, active, ability.color);

        ctx.font = '500 8px "Segoe UI", sans-serif';
        ctx.fillStyle = active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ability.shortName, x + iconSize + 6, y + 7);

        // Timer
        ctx.font = '500 8px Consolas, monospace';
        ctx.fillStyle = active ? ability.color : `rgba(${r},${g},${b},0.2)`;
        ctx.textAlign = 'right';
        ctx.fillText(active ? formatTimeShort(time) : '\u2014', x + w - 4, y + 7);
    }

    private drawSideTimers(
        ctx: CanvasRenderingContext2D,
        abilities: AbilityDef[],
        state: AppState,
        x: number, y: number,
        align: 'left' | 'right',
    ): void {
        for (const ability of abilities) {
            const abilityState = state.abilities[ability.id];
            const active = abilityState?.active || false;
            const [r, g, b] = hexToRgb(ability.color);

            ctx.font = '500 9px Consolas, monospace';
            ctx.fillStyle = active ? ability.color : `rgba(${r},${g},${b},0.2)`;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';

            const timeStr = active ? formatTimeShort(abilityState?.time || 0) : '\u2014';
            ctx.fillText(timeStr, x, y);

            ctx.font = '7px "Segoe UI", sans-serif';
            ctx.fillStyle = active ? `rgba(${r},${g},${b},0.6)` : `rgba(${r},${g},${b},0.2)`;
            ctx.fillText(ability.shortName, x, y + 12);

            y += 28;
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
        if (!def) return { width: 340, height: 260 };

        switch (def.id as CombatStyle) {
            case 'necromancy': return { width: 280, height: 280 }; // +20 for Bloat bar
            case 'magic': return { width: 320, height: 260 };
            case 'ranged': return { width: 340, height: 250 };
            case 'melee': return { width: 300, height: 240 };
            default: return { width: 340, height: 260 };
        }
    }
}
