import type { SpecLayoutMode } from "@/hooks/use-preview-store";

export type SpecPlacement = {
  x: number;
  y: number;
  scale: number;
};

export type SpecAlign = "left" | "right" | "center";

export function evenPositions(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round((start + step * i) * 10) / 10
  );
}

/** Pick a centered subset of Y slots so uneven left/right columns stay balanced. */
export function pickCenteredYs(count: number, slots: number[]): number[] {
  if (count <= 0) return [];
  if (count >= slots.length) return slots.slice(0, count);
  const start = Math.ceil((slots.length - count) / 2);
  return slots.slice(start, start + count);
}

export function generateAlignedPlacements(
  layout: SpecLayoutMode,
  cardIds: string[]
): Record<string, SpecPlacement> {
  const count = cardIds.length;
  const result: Record<string, SpecPlacement> = {};

  switch (layout) {
    case "left": {
      const ys = evenPositions(count, 18, 82);
      cardIds.forEach((id, i) => {
        result[id] = { x: 13, y: ys[i] ?? 50, scale: 1 };
      });
      break;
    }
    case "right": {
      const ys = evenPositions(count, 18, 82);
      cardIds.forEach((id, i) => {
        result[id] = { x: 87, y: ys[i] ?? 50, scale: 1 };
      });
      break;
    }
    case "bottom": {
      const xs = evenPositions(count, 16, 84);
      cardIds.forEach((id, i) => {
        result[id] = { x: xs[i] ?? 50, y: 84, scale: 1 };
      });
      break;
    }
    case "around":
    default: {
      const half = Math.ceil(count / 2);
      const leftIds = cardIds.slice(0, half);
      const rightIds = cardIds.slice(half);
      const slotCount = Math.max(leftIds.length, rightIds.length, 1);
      const sharedYs = evenPositions(slotCount, 24, 76);
      const leftYs = pickCenteredYs(leftIds.length, sharedYs);
      const rightYs = pickCenteredYs(rightIds.length, sharedYs);

      leftIds.forEach((id, i) => {
        result[id] = { x: 13, y: leftYs[i] ?? 50, scale: 1 };
      });
      rightIds.forEach((id, i) => {
        result[id] = { x: 87, y: rightYs[i] ?? 50, scale: 1 };
      });
      break;
    }
  }

  return result;
}

export function getAlignForPlacement(
  layout: SpecLayoutMode,
  x: number
): SpecAlign {
  if (layout === "bottom") return "center";
  if (layout === "left" || x < 50) return "left";
  if (layout === "right" || x >= 50) return "right";
  return "left";
}

export function getAllSpecCards(
  left: { id: string; value: string; description: string }[],
  right: { id: string; value: string; description: string }[]
) {
  return [...left, ...right];
}

export function placementsToHudLines(
  placements: Record<string, SpecPlacement>,
  cardIds: string[],
  productCenter = { x: 50, y: 50 }
) {
  return cardIds
    .map((id) => placements[id])
    .filter(Boolean)
    .map((p) => ({
      x1: p.x,
      y1: p.y,
      x2: productCenter.x + (p.x < 50 ? 10 : -10),
      y2: productCenter.y + (p.y - 50) * 0.12,
    }));
}
