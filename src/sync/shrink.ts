// D32: the photo leaves the phone small and without metadata.
import { b64 } from './crypto';

/** The phone's photo → a JPEG of at most `max` px a side. Drawing it anew drops EXIF (place, time, device). */
export async function shrink(file: Blob, max = 1280, quality = 0.8): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('jpeg'))), 'image/jpeg', quality));
  return b64(new Uint8Array(await blob.arrayBuffer()));
}

/** D101: the piece of a page a line was read from (`box` in fractions of the page, a little margin around) — a small JPEG
 *  shown beside the line, so the person checks it against the paper without hunting for it. */
export async function cut(page: string, box: [number, number, number, number], max = 900): Promise<string> {
  const bytes = Uint8Array.from(atob(page), (ch) => ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const px = 0.01, py = 0.015; // the model's box is off by about a line's height at most — the margin keeps the line whole
  const x = Math.max(0, box[0] - px) * bmp.width, y = Math.max(0, box[1] - py) * bmp.height;
  const w = Math.min(bmp.width - x, (box[2] + 2 * px) * bmp.width), h = Math.min(bmp.height - y, (box[3] + 2 * py) * bmp.height);
  const scale = Math.min(1, max / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, x, y, w, h, 0, 0, canvas.width, canvas.height);
  // D103: the margin shows the neighbouring lines too — fade it, so the line itself stands out
  const bx = (box[0] * bmp.width - x) * scale, by = (box[1] * bmp.height - y) * scale;
  const bw = box[2] * bmp.width * scale, bh = box[3] * bmp.height * scale;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fillRect(0, 0, canvas.width, Math.max(0, by));
  ctx.fillRect(0, by + bh, canvas.width, canvas.height - by - bh);
  ctx.fillRect(0, by, Math.max(0, bx), bh);
  ctx.fillRect(bx + bw, by, canvas.width - bx - bw, bh);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** D112: a box on a page in fractions of it (x, y from the top left; w, h). */
export interface Box { x: number; y: number; w: number; h: number }

/** D112: the page as it leaves the phone — cut to `[top, bottom]` (fractions of its height) and every box painted over
 *  in solid black; the original never leaves. Boxes are in the uncut page's fractions. */
export async function redact(page: string, crop: { top: number; bottom: number }, boxes: Box[], quality = 0.85): Promise<string> {
  const bytes = Uint8Array.from(atob(page), (ch) => ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const top = Math.round(Math.max(0, Math.min(0.9, crop.top)) * bmp.height);
  const bottom = Math.round(Math.max(0, Math.min(0.9, crop.bottom)) * bmp.height);
  const h = Math.max(1, bmp.height - top - bottom);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, top, bmp.width, h, 0, 0, bmp.width, h);
  ctx.fillStyle = '#000';
  for (const b of boxes) ctx.fillRect(b.x * bmp.width, b.y * bmp.height - top, b.w * bmp.width, b.h * bmp.height);
  bmp.close();
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((x) => (x ? ok(x) : fail(new Error('jpeg'))), 'image/jpeg', quality));
  return b64(new Uint8Array(await blob.arrayBuffer()));
}
