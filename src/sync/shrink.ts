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
