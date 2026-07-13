import {
  enhanceProductPixels,
  floodFillBackground,
  getContentBounds,
  hasSignificantTransparency,
  transparencyRatio,
} from "@/lib/image-cutout";

export type ProcessImageOptions = {
  maxDimension?: number;
  padding?: number;
  removeBackground?: boolean;
  onProgress?: (step: string) => void;
};

export type ProcessImageResult = {
  blob: Blob;
  hadTransparency: boolean;
  usedServer: boolean;
  backgroundRemoved: boolean;
  transparencyRatio: number;
};

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
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

async function measureBlobTransparency(blob: Blob): Promise<number> {
  const img = await loadImageFromBlob(blob);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return 0;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;

  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return transparencyRatio(new Uint8Array(data.buffer), width, height, 4);
}

async function processProductImageClient(
  file: File,
  options: ProcessImageOptions
): Promise<ProcessImageResult> {
  const {
    maxDimension = 1600,
    padding = 12,
    removeBackground = true,
    onProgress,
  } = options;

  onProgress?.("Loading image…");
  const img = await loadImageFromFile(file);

  const scale = Math.min(
    1,
    maxDimension / Math.max(img.naturalWidth, img.naturalHeight)
  );
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  onProgress?.("Removing background…");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(imageData.data.buffer);
  const hadTransparency = hasSignificantTransparency(data, width, height, 4);
  let backgroundRemoved = false;

  if (removeBackground && !hadTransparency) {
    floodFillBackground(data, width, height, 4);
    backgroundRemoved = true;
    imageData.data.set(data);
  }

  onProgress?.("Enhancing…");
  enhanceProductPixels(data, width, height, 4);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);

  onProgress?.("Cropping…");
  const bounds = getContentBounds(data, width, height, 4);
  const pad = padding;
  const sx = Math.max(0, bounds.left - pad);
  const sy = Math.max(0, bounds.top - pad);
  const sw = Math.min(width - sx, bounds.width + pad * 2);
  const sh = Math.min(height - sy, bounds.height + pad * 2);

  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("Canvas unavailable");
  outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  onProgress?.("Saving…");
  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
      "image/png",
      1
    );
  });

  const alphaRatio = await measureBlobTransparency(blob);

  return {
    blob,
    hadTransparency,
    usedServer: false,
    backgroundRemoved: backgroundRemoved && alphaRatio > 0.05,
    transparencyRatio: alphaRatio,
  };
}

async function processProductImageServer(
  file: File,
  options: ProcessImageOptions
): Promise<ProcessImageResult> {
  const { removeBackground = true, onProgress } = options;
  onProgress?.("Uploading…");

  const form = new FormData();
  form.append("file", file);
  form.append("removeBackground", String(removeBackground));

  const response = await fetch("/api/process-product-image", {
    method: "POST",
    body: form,
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("image/png")) {
    throw new Error("Server processing failed");
  }

  const blob = await response.blob();
  if (blob.size < 64) {
    throw new Error("Empty processed image");
  }

  const alphaRatio = await measureBlobTransparency(blob);

  return {
    blob,
    hadTransparency: alphaRatio > 0.08,
    usedServer: true,
    backgroundRemoved: removeBackground && alphaRatio > 0.05,
    transparencyRatio: alphaRatio,
  };
}

export async function processProductImage(
  file: File,
  options: ProcessImageOptions = {}
): Promise<ProcessImageResult> {
  const { removeBackground = true, onProgress } = options;

  if (!removeBackground) {
    return {
      blob: file,
      hadTransparency: false,
      usedServer: false,
      backgroundRemoved: false,
      transparencyRatio: 0,
    };
  }

  let result: ProcessImageResult | null = null;

  try {
    onProgress?.("Processing on server…");
    result = await processProductImageServer(file, options);
    if (result.transparencyRatio < 0.05) {
      throw new Error("Server cutout insufficient");
    }
  } catch {
    onProgress?.("Processing locally…");
    result = await processProductImageClient(file, options);
  }

  return result;
}

export function blobToObjectUrl(blob: Blob) {
  return URL.createObjectURL(blob);
}
