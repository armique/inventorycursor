export const PRODUCT_BASE_WIDTH = 64;
export const PRODUCT_MAX_WIDTH = 520;

/** Center point % — allows image to extend beyond canvas edges */
export const PRODUCT_POSITION_BOUNDS = {
  min: -45,
  max: 145,
} as const;

export const PRODUCT_SCALE_BOUNDS = {
  min: 0.2,
  max: 3.5,
} as const;

export function hasProductImage(src: string | null | undefined): boolean {
  return Boolean(src);
}

export function clampProductPosition(value: number): number {
  return Math.min(
    PRODUCT_POSITION_BOUNDS.max,
    Math.max(PRODUCT_POSITION_BOUNDS.min, value)
  );
}

export const PRODUCT_ROTATION_BOUNDS = {
  min: -60,
  max: 60,
} as const;

export function clampProductRotation(value: number): number {
  return Math.min(
    PRODUCT_ROTATION_BOUNDS.max,
    Math.max(PRODUCT_ROTATION_BOUNDS.min, value)
  );
}

export function clampProductScale(value: number): number {
  return Math.min(
    PRODUCT_SCALE_BOUNDS.max,
    Math.max(PRODUCT_SCALE_BOUNDS.min, value)
  );
}
