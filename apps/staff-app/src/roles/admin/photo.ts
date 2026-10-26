/**
 * Menu photos are resized and converted to WebP in the browser before the upload (S5): the
 * bucket accepts image/webp up to 1 MiB only (migration s5_menu_images_storage). The sizing
 * rules are pure and unit-tested (photo.test.ts); the canvas work runs in the browser.
 */

/** The longest side of a stored photo, in pixels: sharp on a tablet, small on the wire. */
export const PHOTO_MAX_SIDE = 1200;
/** The bucket's limit. */
export const PHOTO_MAX_BYTES = 1024 * 1024;
/** A source file larger than this is refused before decoding (a phone photo is 2 to 8 MB). */
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** WebP qualities tried in turn until the photo fits the bucket's limit. */
export const QUALITIES = [0.82, 0.7, 0.55] as const;

export type PhotoError = 'notImage' | 'tooLarge' | 'unreadable' | 'noWebp' | 'stillTooLarge';

/** Scales width x height down (never up) so the longest side is at most `max`. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Checks a chosen file before it is decoded. */
export function checkSource(file: { type: string; size: number }): PhotoError | null {
  if (!file.type.startsWith('image/')) return 'notImage';
  if (file.size > SOURCE_MAX_BYTES) return 'tooLarge';
  return null;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/webp', quality);
  });
}

/**
 * The photo as a WebP blob of at most PHOTO_MAX_SIDE pixels and PHOTO_MAX_BYTES. A browser
 * that cannot encode WebP (it returns another type, e.g. Safari) gets 'noWebp'.
 */
export async function toWebp(file: File): Promise<{ blob: Blob } | { error: PhotoError }> {
  const invalid = checkSource(file);
  if (invalid) return { error: invalid };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: 'unreadable' };
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return { error: 'unreadable' };
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  for (const quality of QUALITIES) {
    const blob = await encode(canvas, quality);
    if (!blob) return { error: 'unreadable' };
    if (blob.type !== 'image/webp') return { error: 'noWebp' };
    if (blob.size <= PHOTO_MAX_BYTES) return { blob };
  }
  return { error: 'stillTooLarge' };
}
