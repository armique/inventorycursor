import type { CSSProperties } from "react";

import { getTitleFontFamily, type TitleFontId } from "@/themes";

export function mergeTitleFontStyle(
  baseStyle: CSSProperties,
  titleFontId: TitleFontId | null
): CSSProperties {
  if (!titleFontId) return baseStyle;
  return {
    ...baseStyle,
    fontFamily: getTitleFontFamily(titleFontId),
  };
}
