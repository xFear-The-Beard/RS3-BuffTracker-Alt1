import * as a1lib from 'alt1';
import { store, PanelId, OverlayStyle } from './store';
import { OverlayRenderer } from './renderer';
import { ModernRenderer } from './renderers/modern-renderer';
import { CompactRenderer } from './renderers/compact-renderer';
import { ClassicRenderer } from './renderers/classic-renderer';
import { CombatBuffsRenderer } from './renderers/combat-buffs-renderer';
import { ThemedRenderer } from './renderers/themed-renderer';
import { ThemedFramesRenderer } from './renderers/themed-frames-renderer';
import { getStyleDef } from '../data/abilities';

/**
 * Panel configuration for the overlay manager.
 */
interface PanelConfig {
    id: PanelId;
    groupName: string;
    renderer: OverlayRenderer;
    canvas: HTMLCanvasElement;
}

/**
 * Manages the Alt1 overlay rendering loop for all three panels.
 *
 * On each tick (~600ms):
 *  1. For each visible panel, renders to its offscreen canvas
 *  2. Gets ImageData from the canvas
 *  3. Encodes with a1lib.encodeImageString()
 *  4. Pushes to alt1.overLayImage() at the panel's saved position
 *  5. Uses overlay group pattern for flicker-free updates
 */
export class OverlayManager {
    private panels: PanelConfig[];
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private currentStyle: OverlayStyle = 'modern';

    /** Map of available combat gauge renderers by style key. */
    private static readonly GAUGE_RENDERERS: Record<string, () => OverlayRenderer> = {
        compact: () => new CompactRenderer(),
        classic: () => new ClassicRenderer(),
        modern: () => new ModernRenderer(),
        themed: () => new ThemedRenderer(),
        'themed-frames': () => new ThemedFramesRenderer(),
    };

    constructor() {
        const state = store.getState();
        this.currentStyle = state.overlayStyle;

        this.panels = [
            {
                id: 'combat-gauge',
                groupName: 'panel-combat-gauge',
                renderer: this.createGaugeRenderer(this.currentStyle),
                canvas: document.createElement('canvas'),
            },
            {
                id: 'combat-buffs',
                groupName: 'panel-combat-buffs',
                renderer: new CombatBuffsRenderer(),
                canvas: document.createElement('canvas'),
            },
        ];
    }

    private createGaugeRenderer(style: OverlayStyle): OverlayRenderer {
        const factory = OverlayManager.GAUGE_RENDERERS[style];
        return factory ? factory() : new ModernRenderer();
    }

    /**
     * Get a renderer by panel ID.
     */
    getRenderer(panelId: PanelId): OverlayRenderer | undefined {
        return this.panels.find(p => p.id === panelId)?.renderer;
    }

    /**
     * Start the overlay render loop.
     * Called when Alt1 is available and the pixel permission is granted.
     */
    start(): void {
        if (this.renderInterval) return;

        this.renderInterval = setInterval(() => {
            this.renderTick();
        }, 600);

        console.log('[OverlayManager] Started overlay render loop');
    }

    /**
     * Force an immediate render outside the regular interval.
     * Used when state changes to provide instant visual feedback.
     */
    renderNow(): void {
        this.renderTick();
    }

    /**
     * Stop the overlay render loop and clear all overlay groups.
     */
    stop(): void {
        if (this.renderInterval) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }

        // Clear all overlay groups
        if (typeof alt1 !== 'undefined') {
            for (const panel of this.panels) {
                try {
                    alt1.overLaySetGroup(panel.groupName);
                    alt1.overLayClearGroup(panel.groupName);
                } catch {
                    // Ignore errors during cleanup
                }
            }
        }

        console.log('[OverlayManager] Stopped overlay render loop');
    }

    /**
     * Single render tick. Renders all visible panels to their overlay groups.
     */
    private renderTick(): void {
        if (typeof alt1 === 'undefined') return;

        const state = store.getState();
        const styleDef = getStyleDef(state.combatStyle);

        // Hot-swap combat gauge renderer if style changed
        if (state.overlayStyle !== this.currentStyle) {
            this.currentStyle = state.overlayStyle;
            const gaugePanel = this.panels.find(p => p.id === 'combat-gauge');
            if (gaugePanel) {
                gaugePanel.renderer = this.createGaugeRenderer(this.currentStyle);
            }
        }

        for (const panel of this.panels) {
            const panelState = state.panels[panel.id];

            // Master kill switch overrides per-panel visibility. Per-panel state
            // is preserved so the master toggle can restore the prior layout.
            if (state.masterOverlayHidden || !panelState.visible) {
                // Clear overlay group for hidden panels. The active render path
                // freezes the group, so simply calling overLayClearGroup leaves
                // the stale frozen image on screen until Alt1's frozen-overlay
                // timer eventually expires (~10s). Mirror the active path's
                // freeze/clear/refresh sequence so the empty state is pushed
                // immediately and the image disappears the same tick the
                // toggle is flipped.
                try {
                    alt1.overLaySetGroup(panel.groupName);
                    alt1.overLayFreezeGroup(panel.groupName);
                    alt1.overLayClearGroup(panel.groupName);
                    alt1.overLayRefreshGroup(panel.groupName);
                } catch {
                    // Ignore
                }
                continue;
            }

            try {
                // Render to offscreen canvas
                panel.renderer.renderToCanvas(panel.canvas, state, styleDef);

                const ctx = panel.canvas.getContext('2d');
                if (!ctx || panel.canvas.width === 0 || panel.canvas.height === 0) continue;

                // Get image data and encode
                const imageData = ctx.getImageData(0, 0, panel.canvas.width, panel.canvas.height);
                const encodedStr = a1lib.encodeImageString(imageData);

                // Push to overlay using group pattern for flicker-free updates
                alt1.overLaySetGroup(panel.groupName);
                alt1.overLayFreezeGroup(panel.groupName);
                alt1.overLayClearGroup(panel.groupName);

                // Draw the panel at its saved position
                alt1.overLayImage(
                    panelState.x,
                    panelState.y,
                    encodedStr,
                    panel.canvas.width,
                    900 // timeout > interval to prevent gaps between frames
                );

                alt1.overLayRefreshGroup(panel.groupName);
            } catch (e) {
                console.error(`[OverlayManager] Error rendering panel ${panel.id}:`, e);
            }
        }
    }
}
