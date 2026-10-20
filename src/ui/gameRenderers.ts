import { renderRacing, type RenderOpts } from '../core/games/racing/render';
import type { RacingSnapshot } from '../core/games/racing/env';
import { currentTheme } from './theme';

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
  // The scenery follows the light/dark theme; the road is dark in both.
  if (gameId === 'racing') renderRacing(ctx, snap as RacingSnapshot, { daylight: currentTheme() === 'light', ...opts });
}

import { CAR_COLORS } from '../core/games/racing/render';

/** Colour of agent `i` in the given game, matching what the canvas draws. */
export function agentColor(_gameId: string, i: number): string {
  return CAR_COLORS[i % CAR_COLORS.length];
}

export function drawPlaceholder(ctx: CanvasRenderingContext2D, lines: string[]): void {
  const { width: w, height: h } = ctx.canvas;
  const day = currentTheme() === 'light';
  ctx.fillStyle = day ? '#eef1f7' : '#05060a';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Sizes are in CSS pixels: the backing store is far wider than the canvas is
  // drawn on a phone, and a 22px font in it came out at about 6px on screen.
  const px = ctx.canvas.clientWidth ? w / ctx.canvas.clientWidth : 1;
  lines.forEach((line, i) => {
    const big = i === 0;
    ctx.font = `${big ? '600' : '400'} ${Math.round((big ? 20 : 14) * px)}px system-ui, sans-serif`;
    ctx.fillStyle = big ? (day ? '#11141f' : '#e9edf7') : day ? '#586179' : '#8590a8';
    ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 28 * px, w - 16 * px);
  });
}
