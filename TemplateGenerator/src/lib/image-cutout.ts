export function pixelOffset(
  x: number,
  y: number,
  width: number,
  channels: number
) {
  return (y * width + x) * channels;
}

type Rgb = [number, number, number];

function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function isBackgroundPixel(r: number, g: number, b: number): boolean {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const saturation = max === 0 ? 0 : chroma / max;

  if (luminance < 80 && saturation < 0.28 && max < 105) return true;
  if (luminance > 200 && chroma < 45) return true;
  if (luminance > 140 && saturation < 0.18 && chroma < 48) return true;

  const avg = (r + g + b) / 3;
  if (
    Math.abs(r - avg) < 22 &&
    Math.abs(g - avg) < 22 &&
    Math.abs(b - avg) < 22
  ) {
    if (luminance > 120 || luminance < 50) return true;
  }

  return false;
}

function sampleEdgeBackgroundColors(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
): Rgb[] {
  const patch = 7;
  const samples: Rgb[] = [];

  const samplePatch = (startX: number, startY: number) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = startY; y < startY + patch && y < height; y++) {
      for (let x = startX; x < startX + patch && x < width; x++) {
        const o = pixelOffset(x, y, width, channels);
        r += pixels[o];
        g += pixels[o + 1];
        b += pixels[o + 2];
        count++;
      }
    }
    if (count > 0) {
      samples.push([
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
      ]);
    }
  };

  samplePatch(0, 0);
  samplePatch(Math.max(0, width - patch), 0);
  samplePatch(0, Math.max(0, height - patch));
  samplePatch(Math.max(0, width - patch), Math.max(0, height - patch));
  samplePatch(Math.max(0, Math.floor(width / 2) - Math.floor(patch / 2)), 0);
  samplePatch(
    Math.max(0, Math.floor(width / 2) - Math.floor(patch / 2)),
    Math.max(0, height - patch)
  );

  const unique: Rgb[] = [];
  for (const sample of samples) {
    if (
      !unique.some(
        (u) => colorDistance(u[0], u[1], u[2], sample[0], sample[1], sample[2]) < 18
      )
    ) {
      unique.push(sample);
    }
  }

  return unique;
}

function isBackgroundLike(
  r: number,
  g: number,
  b: number,
  edgeColors: Rgb[],
  tolerance: number
) {
  if (isBackgroundPixel(r, g, b)) return true;
  for (const [br, bg, bb] of edgeColors) {
    if (colorDistance(r, g, b, br, bg, bb) <= tolerance) return true;
  }
  return false;
}

export function hasSignificantTransparency(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
) {
  let transparent = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (pixels[i * channels + (channels - 1)] < 20) transparent++;
  }
  return transparent / total > 0.08;
}

export function transparencyRatio(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
) {
  let transparent = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (pixels[i * channels + (channels - 1)] < 20) transparent++;
  }
  return transparent / total;
}

export function floodFillBackground(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
) {
  const edgeColors = sampleEdgeBackgroundColors(pixels, width, height, channels);
  const background = new Uint8Array(width * height);
  const queue: number[] = [];
  const tolerance = 52;

  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (background[i]) return;
    const o = pixelOffset(x, y, width, channels);
    if (
      !isBackgroundLike(
        pixels[o],
        pixels[o + 1],
        pixels[o + 2],
        edgeColors,
        tolerance
      )
    ) {
      return;
    }
    background[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % width;
    const y = Math.floor(i / width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!background[i]) continue;
      const o = pixelOffset(x, y, width, channels);
      const r = pixels[o];
      const g = pixels[o + 1];
      const b = pixels[o + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;

      if (luminance < 28 || (luminance > 228 && chroma < 24)) {
        pixels[o + channels - 1] = 0;
        continue;
      }

      const edge =
        luminance < 80 ? (luminance - 28) / 52 : (255 - luminance) / 48;
      const feather = Math.min(1, Math.max(0, edge));
      pixels[o + channels - 1] = Math.round(
        pixels[o + channels - 1] * feather
      );
    }
  }

  spillRemoveFringe(pixels, width, height, channels, edgeColors);
}

function spillRemoveFringe(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  edgeColors: Rgb[]
) {
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(pixels);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const o = pixelOffset(x, y, width, channels);
        if (next[o + channels - 1] < 40) continue;

        let transparentNeighbors = 0;
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbors) {
          const no = pixelOffset(nx, ny, width, channels);
          if (next[no + channels - 1] < 30) transparentNeighbors++;
        }

        if (
          transparentNeighbors >= 2 &&
          isBackgroundLike(
            next[o],
            next[o + 1],
            next[o + 2],
            edgeColors,
            40
          )
        ) {
          pixels[o + channels - 1] = 0;
        }
      }
    }
  }
}

export function enhanceProductPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = pixelOffset(x, y, width, channels);
      const alpha = pixels[o + channels - 1];
      if (alpha < 16) continue;
      const contrast = 1.08;
      const intercept = 128 * (1 - contrast);
      for (let c = 0; c < 3; c++) {
        pixels[o + c] = Math.min(
          255,
          Math.max(0, Math.round(pixels[o + c] * contrast + intercept))
        );
      }
    }
  }
}

export function getContentBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  alphaThreshold = 18
) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[pixelOffset(x, y, width, channels) + channels - 1];
      if (alpha < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX) {
    return { left: 0, top: 0, width, height };
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
