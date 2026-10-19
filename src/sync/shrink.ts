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
  canvas.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}
