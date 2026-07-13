"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/layout/section-label";
import { FontPickerGrid } from "@/editor/font-picker-grid";
import { mergeTitleFontStyle } from "@/lib/product-title-style";
import { usePreviewStore } from "@/hooks/use-preview-store";
import {
  TITLE_COLORS,
  TITLE_TYPOGRAPHY_PRESETS,
  TYPOGRAPHY_PRESETS,
  getTitleTextStyle,
  getTitleTypographyPreset,
  getTypographyPreset,
} from "@/themes";
import { cn } from "@/lib/utils";

export function ProductTitleEditor() {
  const productTitle = usePreviewStore((s) => s.productTitle);
  const productSubtitle = usePreviewStore((s) => s.productSubtitle);
  const typographyId = usePreviewStore((s) => s.typographyId);
  const titleTypographyId = usePreviewStore((s) => s.titleTypographyId);
  const titleFontId = usePreviewStore((s) => s.titleFontId);
  const titleColorId = usePreviewStore((s) => s.titleColorId);
  const setProductTitle = usePreviewStore((s) => s.setProductTitle);
  const setProductSubtitle = usePreviewStore((s) => s.setProductSubtitle);
  const setTypography = usePreviewStore((s) => s.setTypography);
  const setTitleTypography = usePreviewStore((s) => s.setTitleTypography);
  const setTitleFont = usePreviewStore((s) => s.setTitleFont);
  const setTitleColor = usePreviewStore((s) => s.setTitleColor);

  const activeTitleStyle = getTitleTypographyPreset(titleTypographyId);
  const titlePreviewStyle = mergeTitleFontStyle(
    getTitleTextStyle(titleTypographyId),
    titleFontId
  );
  const subtitlePreviewStyle = mergeTitleFontStyle(
    activeTitleStyle.subtitle,
    titleFontId
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="product-title" className="text-xs text-muted-foreground">
          Product name
        </Label>
        <Input
          id="product-title"
          value={productTitle}
          onChange={(e) => setProductTitle(e.target.value)}
          className="h-10 border-white/[0.08] bg-white/[0.03] text-sm"
          placeholder="ASUS ROG STRIX Z790-E"
          style={titlePreviewStyle}
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="product-subtitle"
          className="text-xs text-muted-foreground"
        >
          Subtitle
        </Label>
        <Input
          id="product-subtitle"
          value={productSubtitle}
          onChange={(e) => setProductSubtitle(e.target.value)}
          className="h-9 border-white/[0.08] bg-white/[0.03] text-xs"
          placeholder="Intel Core i7-12700K Bundle"
          style={subtitlePreviewStyle}
        />
      </div>

      <div className="space-y-2">
        <SectionLabel>Title Font</SectionLabel>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Overrides the font family from Title Style — weight & spacing stay
        </p>
        <FontPickerGrid value={titleFontId} onChange={setTitleFont} />
      </div>

      <div className="space-y-2">
        <SectionLabel>Title Style</SectionLabel>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Hero typography inspired by top product pages
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {TITLE_TYPOGRAPHY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setTitleTypography(preset.id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-all",
                titleTypographyId === preset.id
                  ? "border-violet-500/35 bg-violet-500/10"
                  : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-sm leading-none"
                  style={mergeTitleFontStyle(preset.title, titleFontId)}
                >
                  {preset.label}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {preset.usedBy}
                </span>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">
                {preset.preview}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <SectionLabel>Card Typography</SectionLabel>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Default for all spec cards — override per card in Spec Card panel
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {TYPOGRAPHY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setTypography(preset.id)}
              className={cn(
                "flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-all",
                typographyId === preset.id
                  ? "border-cyan-500/35 bg-cyan-500/10"
                  : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
              )}
            >
              <div className="min-w-0">
                <span
                  className="block truncate text-[11px] font-semibold text-foreground/90"
                  style={{ fontFamily: preset.family }}
                >
                  {preset.label}
                </span>
                <span className="block truncate text-[9px] text-muted-foreground">
                  {preset.usedBy}
                </span>
              </div>
              <span
                className="ml-2 shrink-0 text-base font-bold text-muted-foreground"
                style={{ fontFamily: preset.family }}
              >
                {preset.sample}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Active global: {getTypographyPreset(typographyId).label}
        </p>
      </div>

      <div className="space-y-2">
        <SectionLabel>Title Color</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {TITLE_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              title={color.label}
              onClick={() => setTitleColor(color.id)}
              className={cn(
                "h-9 rounded-lg border transition-all",
                titleColorId === color.id
                  ? "border-white/30 ring-2 ring-violet-500/40"
                  : "border-white/[0.08] hover:border-white/20"
              )}
              style={{ background: color.swatch }}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {TITLE_COLORS.find((c) => c.id === titleColorId)?.label ?? "White"}
        </p>
      </div>
    </div>
  );
}
