/**
 * A picture of one car's race, to send to somebody.
 *
 * The daily race is only worth coming back to if someone else is watching too,
 * and the cheapest way to get them is a result posted in a group chat. So one
 * tap makes a square image - place, points, driver, team colour, Grand Prix -
 * and hands it to the phone's share sheet, or downloads it on a computer.
 *
 * Drawn on a canvas, from the self-hosted fonts, with nothing fetched.
 */
import { getLang, t } from '../i18n';

export interface ShareData {
  driver: string;
  team: string;
  color: string;
  position: number;
  dnf: boolean;
  points: number;
  raceName: string;
  trackName: string;
  date: string;
  bestLap: string | null;
  gained: number | null;
  site: string;
}

const SIZE = 1080;

function placeText(d: ShareData): string {
  if (d.dnf) return 'DNF';
  return `P${d.position}`;
}

export function drawShareCard(ctx: CanvasRenderingContext2D, d: ShareData): void {
  const W = SIZE;
  const H = SIZE;
  // Night, with the team's colour and the accent pooling under it.
  ctx.fillStyle = '#07080d';
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.9, -40, 720, 'rgba(255, 46, 77, 0.35)');
  glow(60, H + 40, 680, 'rgba(0, 224, 255, 0.18)');
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#ffffff';
  for (let x = -H; x < W; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H * 0.5, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The team's colour as a band down the right edge, the way a timing tower does it.
  ctx.fillStyle = d.color;
  ctx.fillRect(W - 36, 0, 36, H);

  const s = t().share;
  const dir = getLang() === 'he' ? 'rtl' : 'ltr';
  ctx.direction = dir;
  ctx.textAlign = 'right';
  const right = W - 90;

  ctx.fillStyle = '#ff2e4d';
  ctx.font = '800 34px Heebo, sans-serif';
  ctx.fillText(`${d.raceName} · ${d.date}`, right, 140);
  ctx.fillStyle = '#8590a8';
  ctx.font = '600 30px Heebo, sans-serif';
  ctx.fillText(s.track(d.trackName), right, 186);

  // The place, huge. Latin digits, drawn left-to-right.
  ctx.direction = 'ltr';
  ctx.fillStyle = d.dnf ? '#8590a8' : d.position === 1 ? '#ffd84d' : '#e9edf7';
  ctx.font = '900 300px "JetBrains Mono", monospace';
  ctx.fillText(placeText(d), right, 520);

  ctx.direction = dir;
  ctx.fillStyle = '#e9edf7';
  ctx.font = '900 84px Heebo, sans-serif';
  ctx.fillText(d.driver, right, 660, W - 180);
  ctx.fillStyle = d.color;
  ctx.font = '700 46px Heebo, sans-serif';
  ctx.fillText(d.team, right, 726, W - 180);

  const stats: string[] = [];
  // Words rather than + and arrows: signs next to digits land on the wrong
  // side of the number in right-to-left text.
  stats.push(s.points(d.points));
  if (d.gained !== null && d.gained !== 0) {
    const n = Math.abs(d.gained);
    stats.push(s.gained(d.gained > 0, n));
  }
  if (d.bestLap) stats.push(s.lap(d.bestLap));
  ctx.fillStyle = '#c8d2e4';
  ctx.font = '700 40px Heebo, sans-serif';
  ctx.fillText(stats.join('   ·   '), right, 830, W - 180);

  ctx.fillStyle = '#e9edf7';
  ctx.font = '900 italic 46px Heebo, sans-serif';
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillText('RL ARENA', 90, H - 90);
  ctx.fillStyle = '#5b657d';
  ctx.font = '600 28px Heebo, sans-serif';
  ctx.fillText(d.site.replace(/^https?:\/\//, ''), 90, H - 48);
  ctx.textAlign = 'right';
  ctx.direction = dir;
  ctx.fillStyle = '#8590a8';
  ctx.font = '600 30px Heebo, sans-serif';
  ctx.fillText(s.tagline, right, H - 90);
}

export async function shareCardBlob(d: ShareData): Promise<Blob> {
  // The fonts are self-hosted and load lazily; a card drawn before they arrive
  // comes out in a fallback face.
  try {
    await Promise.all([document.fonts.load('900 84px Heebo'), document.fonts.load('900 300px "JetBrains Mono"')]);
  } catch {
    // Draw with whatever there is.
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  drawShareCard(canvas.getContext('2d')!, d);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'),
  );
}

/**
 * The share sheet where there is one that takes files (phones), a download
 * everywhere else. Resolves to what happened, for the toast.
 */
export async function shareResult(d: ShareData): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await shareCardBlob(d);
  const file = new File([blob], `rl-arena-${d.driver}.png`, { type: 'image/png' });
  const text = t().share.text(d.driver, d.dnf, d.position, d.raceName);
  const nav = navigator as Navigator & { canShare?: (data: ShareData_) => boolean };
  type ShareData_ = { files?: File[]; text?: string; url?: string; title?: string };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, url: d.site, title: 'RL Arena' } as ShareData_);
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return 'downloaded';
}
