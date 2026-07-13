"use client";

import { motion } from "framer-motion";

import { FloatingProduct } from "@/preview/components/floating-product";
import { HudConnectors } from "@/preview/components/hud-connectors";
import { ProductAtmosphere } from "@/preview/components/product-atmosphere";
import { SpecCardsLayer } from "@/preview/components/spec-cards-layer";
import { TechBadge } from "@/preview/components/tech-badge";
import { ThemeBackground } from "@/preview/components/theme-background";
import { mergeTitleFontStyle } from "@/lib/product-title-style";
import { usePreviewStore } from "@/hooks/use-preview-store";
import {
  getTitleColorStyle,
  getSubtitleColorStyle,
  getTitleTextStyle,
  getSubtitleTextStyle,
  getTypographyStyle,
  getThemeStyle,
} from "@/themes";
import type { TemplateLayoutProps } from "@/types/template";

export function GamingHeroLayout({ data }: TemplateLayoutProps) {
  const activeTheme = usePreviewStore((s) => s.activeTheme);
  const specLayout = usePreviewStore((s) => s.specLayout);
  const specCards = usePreviewStore((s) => s.specCards);
  const specPlacements = usePreviewStore((s) => s.specPlacements);
  const productX = usePreviewStore((s) => s.productX);
  const productY = usePreviewStore((s) => s.productY);
  const productTitle = usePreviewStore((s) => s.productTitle);
  const productSubtitle = usePreviewStore((s) => s.productSubtitle);
  const typographyId = usePreviewStore((s) => s.typographyId);
  const titleTypographyId = usePreviewStore((s) => s.titleTypographyId);
  const titleFontId = usePreviewStore((s) => s.titleFontId);
  const titleColorId = usePreviewStore((s) => s.titleColorId);

  const titleColorStyle = getTitleColorStyle(titleColorId);
  const subtitleColorStyle = getSubtitleColorStyle(titleColorId);
  const titleTypeStyle = mergeTitleFontStyle(
    getTitleTextStyle(titleTypographyId),
    titleFontId
  );
  const subtitleTypeStyle = mergeTitleFontStyle(
    getSubtitleTextStyle(titleTypographyId),
    titleFontId
  );
  const typographyStyle = getTypographyStyle(typographyId);

  const cardIds = specCards.map((c) => c.uid);

  return (
    <div
      data-theme={activeTheme}
      style={{
        ...getThemeStyle(activeTheme),
        ...typographyStyle,
        fontFamily: "var(--t-font-family)",
      }}
      className="absolute inset-0 overflow-hidden rounded-2xl"
    >
      <div
        className="absolute inset-0 rounded-2xl ring-1"
        style={{
          boxShadow: "var(--t-card-shadow)",
          borderColor: "var(--t-ring)",
        }}
      >
        <ThemeBackground />
        <ProductAtmosphere />

        <div className="relative grid h-full grid-rows-[auto_1fr_auto] px-[3.5%] pb-[2.2%] pt-[2.5%]">
          <motion.header
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, duration: 0.36 }}
            className="relative z-10 shrink-0"
          >
            <h1
              className="text-[clamp(13px,1.85vw,24px)]"
              style={{ ...titleColorStyle, ...titleTypeStyle }}
            >
              {productTitle}
            </h1>
            <p
              className="mt-0.5 text-[clamp(8.5px,1vw,13px)]"
              style={{ ...subtitleColorStyle, ...subtitleTypeStyle }}
            >
              {productSubtitle}
            </p>
          </motion.header>

          <div className="relative min-h-0 flex-1">
            <HudConnectors
              layout={specLayout}
              placements={specPlacements}
              cardIds={cardIds}
              productCenter={{ x: productX, y: productY }}
            />
            <SpecCardsLayer />
            <FloatingProduct />
          </div>

          <motion.footer
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.34 }}
            className="relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1"
          >
            {data.badges.map((badge, i) => (
              <TechBadge key={badge.id} data={badge} index={i} />
            ))}
          </motion.footer>
        </div>
      </div>
    </div>
  );
}
