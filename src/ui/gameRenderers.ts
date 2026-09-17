import { renderRacing, type RenderOpts } from '../core/games/racing/render';
import type { RacingSnapshot } from '../core/games/racing/env';

/**
 * Rendering lives on the main thread only, so the worker bundle never pulls in
 * canvas code. Snapshots arrive as plain structured-cloned objects.
 */
export function renderGame(
  gameId: string,
  ctx: CanvasRenderingContext2D,
  snap: unknown,
  opts: RenderOpts = {},
): void {
  if (gameId === 'racing') renderRacing(ctx, snap as RacingSnapshot, opts);
}

import { CAR_COLORS } from '../core/games/racing/render';

/** Colour of agent `i` in the given game, matching what the canvas draws. */
export function agentColor(_gameId: string, i: number): string {
  return CAR_COLORS[i % CAR_COLORS.length];
}

export function drawPlaceholder(ctx: CanvasRenderingContext2D, lines: string[]): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const big = i === 0;
    ctx.font = `${big ? '600 22px' : '14px'} system-ui, sans-serif`;
    ctx.fillStyle = big ? '#e9edf7' : '#8590a8';
    ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 30);
  });
}
