import type { InventoryItem } from '../types';
import type { ProductCardTemplate } from './productCardTemplates';
import {
  getProductCardBackground,
  type ProductCardBackgroundId,
  type ProductCardBackgroundPreset,
} from './productCardBackgrounds';
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
  /** Overrides template.backgroundId for hero-showcase layouts. */
  backgroundId?: ProductCardBackgroundId;
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
  const { bgFrom, bgTo } = template.theme;
  const grad = ctx.createLinearGradient(0, 0, 0, PRODUCT_CARD_HEIGHT);
  grad.addColorStop(0, bgFrom);
  grad.addColorStop(1, bgTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);

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

  ctx.fillStyle = template.theme.accent;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 6, PRODUCT_CARD_WIDTH, 1);
}

function drawWoodGrain(ctx: CanvasRenderingContext2D, w: number, h: number, from: string, to: string) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, from);
  base.addColorStop(1, to);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let y = 0; y < h; y += 6) {
    const wave = Math.sin(y * 0.018) * 18 + Math.sin(y * 0.042) * 8;
    ctx.strokeStyle = y % 24 === 0 ? 'rgba(60, 40, 15, 0.35)' : 'rgba(90, 60, 25, 0.2)';
    ctx.lineWidth = y % 24 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 48) {
      ctx.lineTo(x, y + wave * Math.sin(x * 0.004));
    }
    ctx.stroke();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.85);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function drawShowcaseOuterBackground(ctx: CanvasRenderingContext2D, bg: ProductCardBackgroundPreset) {
  if (bg.outerStyle === 'wood') {
    drawWoodGrain(ctx, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT, bg.outerFrom, bg.outerTo);
    return;
  }
  const grad = ctx.createLinearGradient(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);
  grad.addColorStop(0, bg.outerFrom);
  grad.addColorStop(1, bg.outerTo);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PRODUCT_CARD_WIDTH, PRODUCT_CARD_HEIGHT);
}

function drawShowcaseInnerCard(
  ctx: CanvasRenderingContext2D,
  bg: ProductCardBackgroundPreset,
  isDark: boolean
) {
  const margin = 36;
  const x = margin;
  const y = margin;
  const w = PRODUCT_CARD_WIDTH - margin * 2;
  const h = PRODUCT_CARD_HEIGHT - margin * 2;
  const r = 28;

  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(15, 23, 42, 0.14)';
  ctx.shadowBlur = isDark ? 48 : 36;
  ctx.shadowOffsetY = isDark ? 16 : 12;
  drawRoundedRect(ctx, x, y, w, h, r);
  const inner = ctx.createLinearGradient(x, y, x, y + h);
  inner.addColorStop(0, bg.innerFrom);
  inner.addColorStop(0.55, bg.innerFrom);
  inner.addColorStop(1, bg.innerTo);
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.restore();

  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  return { x, y, w, h, r };
}

function drawFeatureIcon(
  ctx: CanvasRenderingContext2D,
  kind: 'check' | 'board' | 'layers' | 'truck',
  cx: number,
  cy: number,
  size: number,
  stroke: string
) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const s = size * 0.38;
  if (kind === 'check') {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.35, cy);
    ctx.lineTo(cx - s * 0.05, cy + s * 0.32);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.28);
    ctx.stroke();
  } else if (kind === 'board') {
    const bw = s * 1.4;
    const bh = s * 1.1;
    drawRoundedRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 4);
    ctx.stroke();
    ctx.fillRect(cx - bw * 0.28, cy - bh * 0.22, bw * 0.22, bh * 0.18);
    ctx.fillRect(cx + bw * 0.06, cy - bh * 0.22, bw * 0.22, bh * 0.18);
    ctx.fillRect(cx - bw * 0.1, cy + bh * 0.08, bw * 0.55, bh * 0.12);
  } else if (kind === 'layers') {
    for (let i = 0; i < 3; i++) {
      const oy = i * 5 - 5;
      drawRoundedRect(ctx, cx - s, cy - s * 0.5 + oy, s * 2, s * 0.9, 3);
      ctx.stroke();
    }
  } else {
    const tw = s * 1.5;
    const th = s * 0.9;
    drawRoundedRect(ctx, cx - tw * 0.35, cy - th * 0.35, tw * 0.55, th * 0.7, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + tw * 0.28, cy + th * 0.15, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - tw * 0.12, cy + th * 0.15, s * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.moveTo(cx - tw * 0.35, cy - th * 0.1);
    ctx.lineTo(cx + tw * 0.2, cy - th * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

function featureIconKind(text: string, index: number): 'check' | 'board' | 'layers' | 'truck' {
  const t = text.toLowerCase();
  if (/versand|shipping|liefer|werktag|delivery|schnell/.test(t)) return 'truck';
  if (/atx|micro|motherboard|mainboard|form/.test(t)) return 'board';
  if (/pla|material|druck|print|3d|deutschland|germany/.test(t)) return index % 2 === 0 ? 'check' : 'layers';
  return (['check', 'board', 'layers', 'truck'] as const)[index % 4];
}

function drawShowcaseFeatureCallout(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'right',
  theme: ProductCardTemplate['theme'],
  iconIndex: number,
  anchorX: number,
  anchorY: number,
  isDark: boolean
) {
  const iconSize = 52;
  const iconCx = align === 'left' ? x + iconSize / 2 + 4 : x + width - iconSize / 2 - 4;
  const iconCy = y + iconSize / 2 + 8;
  const textX = align === 'left' ? x + iconSize + 18 : x + width - iconSize - 18;
  const textAlign = align;

  ctx.save();
  ctx.beginPath();
  ctx.arc(iconCx, iconCy, iconSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255, 0.92)';
  ctx.fill();
  ctx.strokeStyle = isDark ? theme.surfaceBorder : 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawFeatureIcon(ctx, featureIconKind(text, iconIndex), iconCx, iconCy, iconSize, theme.text);
  ctx.restore();

  ctx.textAlign = textAlign;
  ctx.textBaseline = 'top';
  ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = theme.text;
  const lines = wrapText(ctx, text.toUpperCase(), width - iconSize - 28, 3);
  let ty = y + 10;
  for (const line of lines) {
    ctx.fillText(line, textX, ty);
    ty += 20;
  }

  const lineStartX = align === 'left' ? x + width + 4 : x - 4;
  const lineStartY = iconCy;
  ctx.beginPath();
  ctx.moveTo(lineStartX, lineStartY);
  const midX = (lineStartX + anchorX) / 2;
  ctx.bezierCurveTo(midX, lineStartY, midX, anchorY, anchorX, anchorY);
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(100, 116, 139, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(100, 116, 139, 0.55)';
  ctx.fill();

  ctx.textAlign = 'left';
}

function drawShowcaseHeroPhotoLight(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  maxSize: number,
  isDark: boolean
) {
  const scale = Math.min(maxSize / img.width, maxSize / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = cx - dw / 2;
  const dy = cy - dh / 2;

  ctx.save();
  ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(15, 23, 42, 0.22)';
  ctx.shadowBlur = isDark ? 56 : 42;
  ctx.shadowOffsetY = isDark ? 28 : 18;
  const floor = ctx.createRadialGradient(cx, cy + dh * 0.42, 4, cx, cy + dh * 0.42, dw * 0.55);
  floor.addColorStop(0, isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15, 23, 42, 0.12)');
  floor.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.ellipse(cx, cy + dh * 0.44, dw * 0.48, dh * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(img, dx, dy, dw, dh);
}

function buildShowcaseCallouts(
  template: ProductCardTemplate,
  item: InventoryItem,
  categoryFields?: string[]
): string[] {
  const usps = template.usps.filter(Boolean).slice(0, 4);
  if (usps.length >= 4 || !template.showSpecs) return usps;

  const specs = getProductCardSpecs(item, categoryFields, template.maxSpecs);
  const specLines = specs.map((s) => `${s.label}: ${s.value}`);
  return [...usps, ...specLines].slice(0, 4);
}

async function renderPremiumShowcaseCard(
  ctx: CanvasRenderingContext2D,
  input: {
    item: InventoryItem;
    template: ProductCardTemplate;
    photo: HTMLImageElement;
    categoryFields?: string[];
    family: ReturnType<typeof detectProductCardFamily>;
    backgroundId?: ProductCardBackgroundId;
  }
) {
  const { item, template, photo, categoryFields, family, backgroundId } = input;
  const bg = getProductCardBackground(backgroundId ?? template.backgroundId);
  const theme = { ...template.theme, ...bg.theme };
  const isDark = bg.id === 'midnight';

  drawShowcaseOuterBackground(ctx, bg);
  const card = drawShowcaseInnerCard(ctx, bg, isDark);
  const pad = card.x + 44;
  const innerW = card.w - 88;
  const centerX = PRODUCT_CARD_WIDTH / 2;

  let headerY = card.y + 52;

  ctx.save();
  ctx.beginPath();
  drawRoundedRect(ctx, card.x, card.y, card.w, card.h, card.r);
  ctx.clip();

  ctx.fillStyle = theme.accent;
  ctx.fillRect(pad - 20, headerY + 4, 5, 44);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = theme.text;
  const titleLines = wrapText(ctx, item.name.toUpperCase(), innerW - 24, 2);
  for (const line of titleLines) {
    ctx.fillText(line, pad, headerY);
    headerY += 36;
  }

  const badge = getProductCardBadge(item, family);
  const subtitle = template.tagline?.trim() || getProductCardSubtitle(item);
  if (badge || subtitle) {
    headerY += 6;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = theme.textMuted;
    const sub = badge ? `${badge} · ${subtitle}` : subtitle;
    ctx.fillText(sub, pad, headerY);
    headerY += 28;
  } else {
    headerY += 12;
  }

  const heroCy = card.y + card.h * 0.48;
  const heroMax = Math.min(card.w * 0.52, 500);
  drawShowcaseHeroPhotoLight(ctx, photo, centerX, heroCy, heroMax, isDark);

  const callouts = buildShowcaseCallouts(template, item, categoryFields);
  const calloutW = 248;
  const leftX = pad - 8;
  const rightX = card.x + card.w - pad - calloutW + 8;
  const leftYs = [heroCy - 168, heroCy + 72];
  const rightYs = [heroCy - 48, heroCy + 192];
  const heroHalf = heroMax * 0.38;

  callouts.forEach((text, i) => {
    const isLeft = i % 2 === 0;
    const sideIndex = Math.floor(i / 2);
    if (isLeft) {
      const y = leftYs[sideIndex];
      if (y == null) return;
      drawShowcaseFeatureCallout(
        ctx,
        text,
        leftX,
        y,
        calloutW,
        'left',
        theme,
        i,
        centerX - heroHalf,
        y + 36,
        isDark
      );
    } else {
      const y = rightYs[sideIndex];
      if (y == null) return;
      drawShowcaseFeatureCallout(
        ctx,
        text,
        rightX,
        y,
        calloutW,
        'right',
        theme,
        i,
        centerX + heroHalf,
        y + 36,
        isDark
      );
    }
  });

  if (template.showPrice) {
    const price = getProductCardPrice(item);
    const priceY = card.y + card.h - 118;
    ctx.textAlign = 'center';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = theme.textMuted;
    ctx.fillText(price.label.toUpperCase(), centerX, priceY);
    ctx.font = '800 48px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = theme.text;
    ctx.fillText(price.value, centerX, priceY + 18);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = '500 12px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = isDark ? 'rgba(161, 161, 170, 0.55)' : 'rgba(100, 116, 139, 0.65)';
  const footer = template.aiMeta
    ? `${template.aiMeta.provider} · ${new Date(template.aiMeta.generatedAt).toLocaleDateString('de-DE')}`
    : 'DeInventory Pro';
  ctx.fillText(footer, centerX, card.y + card.h - 22);
  ctx.textAlign = 'left';
  ctx.restore();
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
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 28);
  ctx.clip();

  ctx.fillStyle = template.theme.surface;
  ctx.fillRect(x, y, w, h);

  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 28);
  ctx.strokeStyle = template.theme.surfaceBorder;
  ctx.lineWidth = 2;
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
  const cols = 2;
  const cellW = (width - 16) / cols;
  const cellH = 72;
  specs.forEach((spec, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cellW + 16);
    const cy = y + row * (cellH + 12);

    drawRoundedRect(ctx, cx, cy, cellW, cellH, 14);
    ctx.fillStyle = template.theme.surface;
    ctx.fill();
    ctx.fillStyle = template.theme.accent;
    ctx.fillRect(cx, cy + 10, 4, cellH - 20);
    ctx.strokeStyle = template.theme.surfaceBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = template.theme.textMuted;
    ctx.textBaseline = 'top';
    ctx.fillText(spec.label.toUpperCase(), cx + 14, cy + 12);

    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = template.theme.text;
    const val = spec.value.length > 22 ? `${spec.value.slice(0, 20)}…` : spec.value;
    ctx.fillText(val, cx + 14, cy + 34);
  });
}

export async function renderProductCardToCanvas(input: ProductCardRenderInput): Promise<HTMLCanvasElement> {
  const { item, template, photoUrl, categoryFields, backgroundId } = input;
  const family = detectProductCardFamily(item);
  const canvas = document.createElement('canvas');
  canvas.width = PRODUCT_CARD_WIDTH;
  canvas.height = PRODUCT_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const photo = await loadPhotoForCanvas(photoUrl);

  if (template.layout === 'hero-showcase') {
    await renderPremiumShowcaseCard(ctx, { item, template, photo, categoryFields, family, backgroundId });
    return canvas;
  }

  drawGradientBackground(ctx, template);

  const isCenter = template.layout === 'hero-center';
  const pad = 56;

  const photoBox = isCenter
    ? { x: pad, y: 120, w: PRODUCT_CARD_WIDTH - pad * 2, h: 520 }
    : { x: pad, y: 100, w: 460, h: 460 };

  drawPhoto(ctx, photo, photoBox.x, photoBox.y, photoBox.w, photoBox.h, template);

  const textX = isCenter ? pad : photoBox.x + photoBox.w + 40;
  const textW = isCenter ? PRODUCT_CARD_WIDTH - pad * 2 : PRODUCT_CARD_WIDTH - textX - pad;
  let textY = isCenter ? photoBox.y + photoBox.h + 36 : 100;

  const badge = getProductCardBadge(item, family);
  if (badge) {
    drawBadge(ctx, badge, textX, textY, template);
    textY += 56;
  }

  ctx.font = '800 44px "Segoe UI", system-ui, sans-serif';
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
    ctx.font = '700 24px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = template.theme.textMuted;
    ctx.fillText(price.label.toUpperCase(), textX, textY);
    ctx.font = '800 56px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = template.theme.accent;
    ctx.fillText(price.value, textX, textY + 32);
    textY += isCenter ? 110 : 100;
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

  const footerLeft = template.aiMeta
    ? `Design: ${template.aiMeta.provider} · ${new Date(template.aiMeta.generatedAt).toLocaleDateString('de-DE')}`
    : 'DeInventory Pro · Premium Listing Card';
  ctx.font = '600 17px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = template.theme.textMuted;
  ctx.textBaseline = 'bottom';
  ctx.fillText(footerLeft, pad, PRODUCT_CARD_HEIGHT - 36);
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
