import { OverlayRenderer, hexToRgba, formatTime, roundRect } from '../renderer';
import { AppState, AbilityState, BuffTrackMode } from '../store';
import { StyleDef } from '../../data/abilities';
import { alarmManager } from '../alarm-manager';

/**
 * Buff entry for rendering. Represents a tracked buff with its current state.
 */
interface BuffEntry {
    id: string;
    name: string;
    mode: BuffTrackMode;
    active: boolean;
    time: number;
    color: string;
}

/**
 * Combat Buffs checklist renderer (Panel 2).
 * Shows tracked buffs with their status: active (green), expired (red), or hidden.
 */
export class CombatBuffsRenderer implements OverlayRenderer {
    private _showBg: boolean = true;

    /**
     * Collect renderable buff entries based on tracking mode and state.
     */
    private getVisibleBuffs(state: AppState): BuffEntry[] {
        const entries: BuffEntry[] = [];

        for (const [id, mode] of Object.entries(state.combatBuffTracking)) {
            if (mode === 'off') continue;

            const abilityState = state.abilities[id];
            const active = abilityState?.active || false;
            const time = abilityState?.time || 0;

            // 'monitor' mode: only show active buffs
            if (mode === 'monitor' && !active) continue;

            // Determine display name and color from the ability id
            const name = this.getBuffName(id);
            const color = this.getBuffColor(id, active);

            entries.push({ id, name, mode, active, time, color });
        }

        return entries;
    }

    private getBuffName(id: string): string {
        // Convert ability_id to display name
        return id
            .split('_')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    private getBuffColor(_id: string, active: boolean): string {
        return active ? '#22c55e' : '#ef4444';
    }

    // =====================================================================
    // HTML Rendering
    // =====================================================================

    renderToHTML(container: HTMLElement, state: AppState, _styleDef?: StyleDef): void {
        const buffs = this.getVisibleBuffs(state);

        let html = '';

        // Panel header
        html += `
            <div class="buffs-header">
                <span class="buffs-title">Combat Buffs</span>
            </div>
        `;

        if (buffs.length === 0) {
            html += `<div class="buffs-empty">No tracked buffs</div>`;
        } else {
            for (const buff of buffs) {
                html += this.renderBuffEntryHTML(buff);
            }
        }

        container.innerHTML = html;
    }

    private renderBuffEntryHTML(buff: BuffEntry): string {
        const borderColor = buff.active ? '#22c55e' : '#ef4444';
        const bgColor = buff.active ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';
        const textColor = buff.active ? '#86efac' : '#fca5a5';
        const timerStr = buff.active ? formatTime(buff.time) : 'EXPIRED';
        const timerColor = buff.active ? '#22c55e' : '#ef4444';
        const flashClass = (!buff.active && alarmManager.isFlashing(buff.id)) ? ' buffs-entry-flash' : '';

        return `
            <div class="buffs-entry${flashClass}" style="border-left: 2px solid ${borderColor}; background: ${bgColor};">
                <span class="buffs-entry-name" style="color: ${textColor};">${buff.name}</span>
                <span class="buffs-entry-timer" style="color: ${timerColor};">${timerStr}</span>
            </div>
        `;
    }

    // =====================================================================
    // Canvas Rendering
    // =====================================================================

    renderToCanvas(canvas: HTMLCanvasElement, state: AppState, _styleDef?: StyleDef): void {
        this._showBg = state.combatBuffsBackgroundVisible;
        const buffs = this.getVisibleBuffs(state);
        const dims = this.getMinDimensions(state);
        canvas.width = dims.width;
        canvas.height = dims.height;

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this._showBg) {
            // Background
            ctx.fillStyle = 'rgba(8, 6, 16, 225)';
            roundRect(ctx, 0, 0, canvas.width, canvas.height, 8);
            ctx.fill();

            // Border
            ctx.strokeStyle = 'rgba(255, 255, 255, 20)';
            ctx.lineWidth = 1;
            roundRect(ctx, 0.5, 0.5, canvas.width - 1, canvas.height - 1, 8);
            ctx.stroke();
        }

        const padX = 14;
        let y = 10;

        if (this._showBg) {
            // Header
            ctx.font = '500 12px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = '#fcd34d';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('Combat Buffs', padX, y + 6);
        }
        y += 22;

        if (buffs.length === 0) {
            if (this._showBg) {
                ctx.font = '10px "Segoe UI", system-ui, sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('No tracked buffs', canvas.width / 2, y + 10);
            }
            return;
        }

        // Buff entries
        const rowH = 28;
        const w = canvas.width - padX * 2;

        for (const buff of buffs) {
            const borderColor = buff.active ? '#22c55e' : '#ef4444';
            const bgAlpha = 0.08;
            const [br, bg, bb] = buff.active ? [34, 197, 94] : [239, 68, 68];

            if (this._showBg) {
                // Row background
                ctx.fillStyle = `rgba(${br},${bg},${bb},${bgAlpha})`;
                roundRect(ctx, padX, y, w, rowH, 5);
                ctx.fill();
            }

            ctx.fillStyle = borderColor;
            ctx.fillRect(padX, y + 4, 2, rowH - 8);

            // Name
            ctx.font = '12px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = buff.active ? '#86efac' : '#fca5a5';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(buff.name, padX + 10, y + rowH / 2);

            // Timer / EXPIRED
            const timerStr = buff.active ? formatTime(buff.time) : 'EXPIRED';
            ctx.font = '500 13px Consolas, "SF Mono", monospace';
            ctx.fillStyle = buff.active ? '#22c55e' : '#ef4444';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(timerStr, padX + w - 8, y + rowH / 2);

            y += rowH + 4;
        }
    }

    // =====================================================================
    // Dimensions
    // =====================================================================

    getMinDimensions(state: AppState, _styleDef?: StyleDef): { width: number; height: number } {
        const buffs = this.getVisibleBuffs(state);
        const width = 240;
        let height = 10 + 22; // padding + header

        if (buffs.length === 0) {
            height += 28; // empty message
        } else {
            height += buffs.length * 32; // 28 + 4 gap per entry
        }

        height += 10; // bottom padding
        return { width, height };
    }
}
