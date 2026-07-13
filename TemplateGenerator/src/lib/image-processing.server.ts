import sharp from "sharp";

import {
  enhanceProductPixels,
  floodFillBackground,
  getContentBounds,
  hasSignificantTransparency,
} from "@/lib/image-cutout";

export type CutoutOptions = {
  maxDimension?: number;
  padding?: number;
  removeBackground?: boolean;
};

export async function processImageBuffer(
  input: Buffer,
  options: CutoutOptions = {}
): Promise<Buffer> {
  const {
    maxDimension = 1600,
    padding = 12,
    removeBackground = true,
  } = options;

  const base = sharp(input).rotate().ensureAlpha();
  const meta = await base.metadata();
  const resizeNeeded =
    (meta.width ?? 0) > maxDimension || (meta.height ?? 0) > maxDimension;

  let pipeline = resizeNeeded
    ? base.resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
    : base;

  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  if (
    removeBackground &&
    !hasSignificantTransparency(pixels, width, height, channels)
  ) {
    floodFillBackground(pixels, width, height, channels);
  }

  enhanceProductPixels(pixels, width, height, channels);

  const bounds = getContentBounds(pixels, width, height, channels);
  const pad = padding;
  const extractLeft = Math.max(0, bounds.left - pad);
  const extractTop = Math.max(0, bounds.top - pad);
  const extractWidth = Math.min(
    width - extractLeft,
    bounds.width + pad * 2
  );
  const extractHeight = Math.min(
    height - extractTop,
    bounds.height + pad * 2
  );

  return sharp(Buffer.from(pixels), { raw: { width, height, channels } })
    .extract({
      left: extractLeft,
      top: extractTop,
      width: extractWidth,
      height: extractHeight,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
