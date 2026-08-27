/** Applies an AI-suggested crop box (fractions of the full image) to a photo File before upload. */

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image file'));
    };
    img.src = url;
  });
}

/** True when the box is (close enough to) the full image — cropping would be a no-op. */
export function isFullFrameBox(box: CropBox): boolean {
  return box.x <= 0.005 && box.y <= 0.005 && box.width >= 0.99 && box.height >= 0.99;
}

/** Crops `file` to `box` (fractions 0-1) and returns a new File with the same name/type. */
export async function cropFileToBox(file: File, box: CropBox): Promise<File> {
  if (isFullFrameBox(box)) return file;
  const img = await loadImageFromFile(file);
  const sx = Math.round(box.x * img.naturalWidth);
  const sy = Math.round(box.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(box.width * img.naturalWidth));
  const sh = Math.max(1, Math.round(box.height * img.naturalHeight));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const type = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) return file;
  return new File([blob], file.name, { type, lastModified: Date.now() });
}
