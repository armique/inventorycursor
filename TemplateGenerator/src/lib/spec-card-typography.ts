import type { CSSProperties } from "react";

import type { EditableSpecCard } from "@/lib/spec-cards";
import {
  getTitleColorStyle,
  getTypographyPreset,
  type TitleColorId,
  type TypographyId,
} from "@/themes";

export type SpecTextSizeId = "sm" | "md" | "lg";

export const SPEC_VALUE_FONT_SIZES: Record<SpecTextSizeId, string> = {
  sm: "12px",
  md: "14px",
  lg: "16px",
};

export const SPEC_DESC_FONT_SIZES: Record<SpecTextSizeId, string> = {
  sm: "9px",
  md: "10px",
  lg: "11px",
};

export const SPEC_TEXT_SIZE_OPTIONS: {
  id: SpecTextSizeId | null;
  label: string;
}[] = [
  { id: null, label: "Default" },
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
];

export function resolveCardTypographyId(
  card: EditableSpecCard,
  globalTypographyId: TypographyId
): TypographyId {
  return card.typographyId ?? globalTypographyId;
}

function resolveCardColorStyle(
  colorId: TitleColorId | null | undefined,
  role: "value" | "description"
): CSSProperties {
  if (!colorId) {
    return role === "value"
      ? { color: "var(--t-text)" }
      : { color: "var(--t-text-muted)" };
  }

  const style = getTitleColorStyle(colorId);
  if (role === "description") {
    if (style.backgroundImage) {
      return { color: "var(--t-text-muted)" };
    }
    return {
      color: style.color,
      opacity: 0.55,
    };
  }

  return style;
}

export function resolveSpecCardValueStyle(
  card: EditableSpecCard,
  globalTypographyId: TypographyId
): CSSProperties {
  const typographyId = resolveCardTypographyId(card, globalTypographyId);
  const preset = getTypographyPreset(typographyId);

  return {
    fontFamily: preset.family,
    letterSpacing: preset.vars["--t-letter-spacing"] ?? "0",
    fontSize: card.valueSize
      ? SPEC_VALUE_FONT_SIZES[card.valueSize]
      : "var(--sc-value-size)",
    fontWeight: "var(--sc-value-weight)",
    ...resolveCardColorStyle(card.valueColorId, "value"),
  };
}

export function resolveSpecCardDescStyle(
  card: EditableSpecCard,
  globalTypographyId: TypographyId
): CSSProperties {
  const typographyId = resolveCardTypographyId(card, globalTypographyId);
  const preset = getTypographyPreset(typographyId);

  return {
    fontFamily: preset.family,
    fontWeight: preset.vars["--t-font-weight"] ?? "500",
    letterSpacing: preset.vars["--t-letter-spacing"] ?? "0",
    fontSize: card.descSize
      ? SPEC_DESC_FONT_SIZES[card.descSize]
      : "var(--sc-desc-size)",
    ...resolveCardColorStyle(card.descColorId, "description"),
  };
}

export function hasSpecCardStyleOverrides(card: EditableSpecCard): boolean {
  return !!(
    card.typographyId ||
    card.valueSize ||
    card.descSize ||
    card.valueColorId ||
    card.descColorId
  );
}

export const SPEC_CARD_RESET_PATCH = {
  typographyId: null,
  valueSize: null,
  descSize: null,
  valueColorId: null,
  descColorId: null,
} as const;

export type SpecCardStylePatch = Pick<
  EditableSpecCard,
  | "typographyId"
  | "valueSize"
  | "descSize"
  | "valueColorId"
  | "descColorId"
>;

export function extractSpecCardStylePatch(
  card: EditableSpecCard
): SpecCardStylePatch {
  return {
    typographyId: card.typographyId ?? null,
    valueSize: card.valueSize ?? null,
    descSize: card.descSize ?? null,
    valueColorId: card.valueColorId ?? null,
    descColorId: card.descColorId ?? null,
  };
}
