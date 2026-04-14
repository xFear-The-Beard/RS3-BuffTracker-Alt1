import { AppState } from './store';
import { StyleDef } from '../data/abilities';

/**
 * Interface for panel renderers.
 * Each panel type (combat gauge, combat buffs) implements this.
 *
 * Two render targets:
 * - HTML: for the Alt1 app window (settings panel preview / demo mode in browser)
 * - Canvas: for Alt1 overlay API (rendered to offscreen canvas, then pushed via overLayImage)
 */
export interface OverlayRenderer {
    /** Render to an offscreen canvas (for Alt1 overlay) */
    renderToCanvas(canvas: HTMLCanvasElement, state: AppState, styleDef?: StyleDef): void;

    /** Render to HTML container (for app window preview / demo mode) */
    renderToHTML(container: HTMLElement, state: AppState, styleDef?: StyleDef): void;

    /** Get minimum dimensions needed */
    getMinDimensions(state: AppState, styleDef?: StyleDef): { width: number; height: number };
}

// --- Shared utility functions for renderers ---

/**
 * Convert hex color to rgba string.
 */
export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Parse hex color to [r, g, b] array.
 */
export function hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

/**
 * Format seconds to display string.
 */
export function formatTime(seconds: number): string {
    if (seconds <= 0) return '\u2014'; // em-dash
    if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    if (seconds >= 60) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }
    return `${seconds}s`;
}

/**
 * Format seconds to short display string (for compact use).
 */
export function formatTimeShort(seconds: number): string {
    if (seconds <= 0) return '\u2014';
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}hr`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
    return `${seconds}s`;
}

/**
 * Draw a rounded rectangle path on a canvas context.
 */
export function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number
): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}
