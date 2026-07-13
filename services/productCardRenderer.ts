import type { InventoryItem } from '../types';
import type { ProductCardTemplate } from './productCardTemplates';
import {
  getProductCardBadge,
  getProductCardPrice,
  getProductCardSpecs,
  getProductCardSubtitle,
  detectProductCardFamily,
} from '../utils/productCardContent';

export const PRODUCT_CARD_WIDTH = 1080;
export const PRODUCT_CARD_HEIGHT = 1350;

export interface ProductCardRenderInput {
  item: InventoryItem;
  template: ProductCardTemplate;
  photoUrl: string;
  categoryFields?: string[];
}

async function loadPhotoForCanvas(url: string): Promise<HTMLImageElement> {
  const tryLoad = (src: string, crossOrigin?: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = src;
    });

  try {
    return await tryLoad(url, 'anonymous');
  } catch {
    // Firebase / external URLs — use server proxy to avoid CORS taint
    const proxy = `/api/images?route=fetch&url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy);
    if (!res.ok) throw new Error('Could not load photo for card');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await tryLoad(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.length > 0) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 3) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines.slice(0, maxLines);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawGradientBackground(ctx: CanvasRenderingContext2D, template: ProductCardTemplate) {
  const isPremium = template.variant === 'premium';
  const { bgFrom, bgTo } = template.theme;

  if (isPremium) {
    const grad = ctx.createLinearGradient(0, 0, PRODUCT_CARD_WIDTH * 0.85, PRODUCT_CARD_HEIGHT);
    grad.addColorStop(0, bgFrom);
    grad.addColorStop(0.55, '#0c0c12');
    grad.addColorStop(1, bgTo);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

    const warm = ctx.createRadialGradient(720, 200, 30, 720, 200, 520);
    warm.addColorStop(0, template.theme.accentSoft);
    warm.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

    const cool = ctx.createRadialGradient(120, PRODUCT_CARD_HEIGHT - 80, 20, 120, PRODUCT_CARD_HEIGHT - 80, 400);
    cool.addColorStop(0, 'rgba(99, 102, 241, 0.08)');
    cool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

    // Subtle film grain
    ctx.save();
    ctx.globalAlpha = 0.035;
    for (let i = 0; i < 2800; i++) {
      const gx = Math.random() * PRODUCT_CARD_WIDTH;
      const gy = Math.random() * PRODUCT_CARD_HEIGHT;
      const g = Math.random() * 40 + 200;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(gx, gy, 1, 1);
    }
    ctx.restore();

    ctx.fillStyle = template.theme.accent;
    ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 4, PRODUCT_CARD_WIDTH, 1);
    return;
  }

  const grad = ctx.createLinearGradient(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);
  grad.addColorStop(0, bgFrom);
  grad.addColorStop(1, bgTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

  // Subtle accent glows
  const glow1 = ctx.createRadialGradient(820, 180, 40, 820, 180, 420);
  glow1.addColorStop(0, template.theme.accentSoft);
  glow1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

  const glow2 = ctx.createRadialGradient(180, PRODUCT_CARD_HEIGHT - 120, 20, 180, PRODUCT_CARD_HEIGHT - 120, 360);
  glow2.addColorStop(0, template.theme.accentSoft);
  glow2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

  // Top accent bar + inner highlight line
  ctx.fillStyle = template.theme.accent;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 6, PRODUCT_CARD_WIDTH, 1);
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  template: ProductCardTemplate
) {
  const isPremium = template.variant === 'premium';
  const radius = isPremium ? 32 : 28;

  if (isPremium) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 18;
    drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, x - 2, y - 2, w + 4, h + 4, radius + 2);
    const rim = ctx.createLinearGradient(x, y, x + w, y + h);
    rim.addColorStop(0, template.theme.accent);
    rim.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    rim.addColorStop(1, template.theme.accent);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.clip();

  ctx.fillStyle = template.theme.surface;
  ctx.fillRect(x, y, w, h);

  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);

  if (isPremium) {
    const vignette = ctx.createRadialGradient(x + w / 2, y + h / 2, w * 0.2, x + w / 2, y + h / 2, w * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(x, y, w, h);

    const shine = ctx.createLinearGradient(x, y, x, y + h * 0.45);
    shine.addColorStop(0, 'rgba(255,255,255,0.12)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, w, h * 0.45);
  }

  ctx.restore();

  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.strokeStyle = template.theme.surfaceBorder;
  ctx.lineWidth = isPremium ? 1.5 : 2;
  ctx.stroke();
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, template: ProductCardTemplate) {
  ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
  const padX = 18;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 40;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = template.theme.accent;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
}

function drawUspPills(ctx: CanvasRenderingContext2D, usps: string[], x: number, y: number, maxWidth: number, template: ProductCardTemplate) {
  ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
  let cx = x;
  let cy = y;
  const gap = 12;
  const lineH = 36;

  for (const usp of usps.slice(0, 4)) {
    const padX = 14;
    const tw = ctx.measureText(usp).width + padX * 2 + 22;
    if (cx + tw > x + maxWidth) {
      cx = x;
      cy += lineH + gap;
    }
    drawRoundedRect(ctx, cx, cy, tw, lineH, 18);
    ctx.fillStyle = template.theme.surface;
    ctx.fill();
    ctx.strokeStyle = template.theme.surfaceBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = template.theme.accent;
    ctx.beginPath();
    ctx.arc(cx + 16, cy + lineH / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = template.theme.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(usp, cx + 28, cy + lineH / 2 + 1);
    cx += tw + gap;
  }
}

function drawSpecGrid(
  ctx: CanvasRenderingContext2D,
  specs: { label: string; value: string }[],
  x: number,
  y: number,
  width: number,
  template: ProductCardTemplate
) {
  const isPremium = template.variant === 'premium';
  const cols = 2;
  const cellW = (width - 16) / cols;
  const cellH = isPremium ? 76 : 72;
  specs.forEach((spec, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cellW + 16);
    const cy = y + row * (cellH + 12);

    drawRoundedRect(ctx, cx, cy, cellW, cellH, isPremium ? 16 : 14);
    if (isPremium) {
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fill();
      ctx.strokeStyle = template.theme.surfaceBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      const accentBar = ctx.createLinearGradient(cx, cy, cx, cy + cellH);
      accentBar.addColorStop(0, template.theme.accent);
      accentBar.addColorStop(1, 'rgba(212, 184, 122, 0.15)');
      ctx.fillStyle = accentBar;
      ctx.fillRect(cx, cy + 12, 3, cellH - 24);
    } else {
      ctx.fillStyle = template.theme.surface;
      ctx.fill();
      ctx.fillStyle = template.theme.accent;
      ctx.fillRect(cx, cy + 10, 4, cellH - 20);
      ctx.strokeStyle = template.theme.surfaceBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.font = `600 ${isPremium ? 14 : 16}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = template.theme.textMuted;
    ctx.textBaseline = 'top';
    ctx.fillText(spec.label.toUpperCase(), cx + 14, cy + 12);

    ctx.font = `700 ${isPremium ? 21 : 22}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = template.theme.text;
    const val = spec.value.length > 22 ? `${spec.value.slice(0, 20)}…` : spec.value;
    ctx.fillText(val, cx + 14, cy + (isPremium ? 36 : 34));
  });
}

export async function renderProductCardToCanvas(input: ProductCardRenderInput): Promise<HTMLCanvasElement> {
  const { item, template, photoUrl, categoryFields } = input;
  const family = detectProductCardFamily(item);
  const canvas = document.createElement('canvas');
  canvas.width = PRODUCT_CARD_WIDTH;
  canvas.height = PRODUCT_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  drawGradientBackground(ctx, template);

  const photo = await loadPhotoForCanvas(photoUrl);
  const isPremium = template.variant === 'premium';
  const isCenter = template.layout === 'hero-center';
  const pad = isPremium ? 52 : 56;

  const photoBox = isCenter
    ? { x: pad, y: isPremium ? 108 : 120, w: PRODUCT_CARD_WIDTH - pad * 2, h: isPremium ? 540 : 520 }
    : {
        x: pad,
        y: isPremium ? 88 : 100,
        w: isPremium ? 500 : 460,
        h: isPremium ? 500 : 460,
      };

  drawPhoto(ctx, photo, photoBox.x, photoBox.y, photoBox.w, photoBox.h, template);

  const textX = isCenter ? pad : photoBox.x + photoBox.w + 40;
  const textW = isCenter ? PRODUCT_CARD_WIDTH - pad * 2 : PRODUCT_CARD_WIDTH - textX - pad;
  let textY = isCenter ? photoBox.y + photoBox.h + 36 : 100;

  const badge = getProductCardBadge(item, family);
  if (badge) {
    drawBadge(ctx, badge, textX, textY, template);
    textY += 56;
  }

  ctx.font = `${isPremium ? '800 46' : '800 44'}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = template.theme.text;
  ctx.textBaseline = 'top';
  const titleLines = wrapText(ctx, item.name, textW, 3);
  for (const line of titleLines) {
    ctx.fillText(line, textX, textY);
    textY += 52;
  }

  if (template.tagline?.trim()) {
    ctx.font = '600 26px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = template.theme.accent;
    const tagLines = wrapText(ctx, template.tagline.trim(), textW, 2);
    for (const line of tagLines) {
      textY += 8;
      ctx.fillText(line, textX, textY);
      textY += 34;
    }
  }

  ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = template.theme.textMuted;
  ctx.fillText(getProductCardSubtitle(item), textX, textY + 8);
  textY += 44;

  if (template.showPrice) {
    const price = getProductCardPrice(item);
    if (isPremium) {
      const priceW = textW;
      const priceH = 96;
      drawRoundedRect(ctx, textX, textY, priceW, priceH, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fill();
      ctx.strokeStyle = template.theme.surfaceBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '700 20px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = template.theme.textMuted;
      ctx.fillText(price.label.toUpperCase(), textX + 18, textY + 16);
      ctx.font = '800 52px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = template.theme.accent;
      ctx.fillText(price.value, textX + 18, textY + 42);
      textY += priceH + 20;
    } else {
      ctx.font = '700 24px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = template.theme.textMuted;
      ctx.fillText(price.label.toUpperCase(), textX, textY);
      ctx.font = '800 56px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = template.theme.accent;
      ctx.fillText(price.value, textX, textY + 32);
      textY += isCenter ? 110 : 100;
    }
  }

  if (template.showSpecs) {
    const specs = getProductCardSpecs(item, categoryFields, template.maxSpecs);
    if (specs.length > 0) {
      const specY = isCenter ? textY : Math.max(textY, photoBox.y + photoBox.h - specs.length * 42);
      drawSpecGrid(ctx, specs, isCenter ? pad : textX, specY, isCenter ? PRODUCT_CARD_WIDTH - pad * 2 : textW, template);
      textY = specY + Math.ceil(specs.length / 2) * 84 + 24;
    }
  }

  const uspY = isCenter ? Math.min(textY + 12, PRODUCT_CARD_HEIGHT - 180) : photoBox.y + photoBox.h + 32;
  drawUspPills(ctx, template.usps, isCenter ? pad : photoBox.x, uspY, isCenter ? PRODUCT_CARD_WIDTH - pad * 2 : photoBox.w + textW + 40, template);

  // Footer
  const footerLeft = template.aiMeta
    ? `Design: ${template.aiMeta.provider} · ${new Date(template.aiMeta.generatedAt).toLocaleDateString('de-DE')}`
    : isPremium
      ? 'DeInventory Pro · Premium Listing'
      : 'DeInventory Pro · Premium Listing Card';
  if (isPremium) {
    drawRoundedRect(ctx, pad, PRODUCT_CARD_HEIGHT - 72, PRODUCT_CARD_WIDTH - pad * 2, 44, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = template.theme.surfaceBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.font = '600 17px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = template.theme.textMuted;
  ctx.textBaseline = 'bottom';
  ctx.fillText(footerLeft, pad + (isPremium ? 14 : 0), PRODUCT_CARD_HEIGHT - (isPremium ? 44 : 36));
  if (template.aiMeta) {
    ctx.textAlign = 'right';
    ctx.fillStyle = template.theme.accent;
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('AI Template', PRODUCT_CARD_WIDTH - pad, PRODUCT_CARD_HEIGHT - 36);
    ctx.textAlign = 'left';
  }

  return canvas;
}

export async function renderProductCardBlob(input: ProductCardRenderInput, quality = 0.92): Promise<Blob> {
  const canvas = await renderProductCardToCanvas(input);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      'image/jpeg',
      quality
    );
  });
}

export async function renderProductCardDataUrl(input: ProductCardRenderInput, quality = 0.92): Promise<string> {
  const canvas = await renderProductCardToCanvas(input);
  return canvas.toDataURL('image/jpeg', quality);
}

export function downloadProductCardBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
