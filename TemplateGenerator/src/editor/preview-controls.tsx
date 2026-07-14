"use client";

import {
  AlignCenter,
  AlignEndHorizontal,
  AlignStartHorizontal,
  ArrowDownToLine,
  BringToFront,
  LayoutGrid,
  RotateCcw,
  SendToBack,
} from "lucide-react";

import { SectionLabel } from "@/components/layout/section-label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePreviewStore, type SpecLayoutMode } from "@/hooks/use-preview-store";
import {
  PRODUCT_POSITION_BOUNDS,
  PRODUCT_ROTATION_BOUNDS,
  PRODUCT_SCALE_BOUNDS,
} from "@/lib/product-image";
import {
  BACKGROUND_TEXTURES,
  CARD_THEMES,
  DARK_BACKGROUND_TEXTURES,
  LIGHT_BACKGROUND_TEXTURES,
  SPEC_CARD_STYLES,
  THEME_LIST,
} from "@/themes";
import type { BackgroundTexture } from "@/themes";
import { cn } from "@/lib/utils";

const SPEC_LAYOUTS: {
  id: SpecLayoutMode;
  label: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: "around", label: "Around", icon: LayoutGrid },
  { id: "left", label: "Left", icon: AlignStartHorizontal },
  { id: "right", label: "Right", icon: AlignEndHorizontal },
  { id: "bottom", label: "Bottom", icon: ArrowDownToLine },
];

export function PreviewControls() {
  const activeTheme = usePreviewStore((s) => s.activeTheme);
  const activeSpecCardStyle = usePreviewStore((s) => s.activeSpecCardStyle);
  const backgroundTextureId = usePreviewStore((s) => s.backgroundTextureId);
  const setBackgroundTexture = usePreviewStore((s) => s.setBackgroundTexture);
  const specLayout = usePreviewStore((s) => s.specLayout);
  const productX = usePreviewStore((s) => s.productX);
  const productY = usePreviewStore((s) => s.productY);
  const imageScaleX = usePreviewStore((s) => s.imageScaleX);
  const imageScaleY = usePreviewStore((s) => s.imageScaleY);
  const imageRotation = usePreviewStore((s) => s.imageRotation);
  const productBehindCards = usePreviewStore((s) => s.productBehindCards);
  const toggleProductBehindCards = usePreviewStore(
    (s) => s.toggleProductBehindCards
  );
  const setActiveTheme = usePreviewStore((s) => s.setActiveTheme);
  const setActiveSpecCardStyle = usePreviewStore((s) => s.setActiveSpecCardStyle);
  const setSpecLayout = usePreviewStore((s) => s.setSpecLayout);
  const alignSpecCards = usePreviewStore((s) => s.alignSpecCards);
  const resetProductTransform = usePreviewStore((s) => s.resetProductTransform);
  const setProductPlacement = usePreviewStore((s) => s.setProductPlacement);
  const setImageScale = usePreviewStore((s) => s.setImageScale);
  const setImageRotation = usePreviewStore((s) => s.setImageRotation);

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Background</SectionLabel>
          <span className="font-mono text-[10px] text-muted-foreground">
            {THEME_LIST.length} themes
          </span>
        </div>
        <ScrollArea className="h-[220px] rounded-xl border border-white/[0.06] pr-3">
          <div className="grid grid-cols-3 gap-2 p-2">
            {THEME_LIST.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => setActiveTheme(theme.id)}
                className={cn(
                  "group relative h-14 overflow-hidden rounded-xl border transition-all",
                  activeTheme === theme.id
                    ? "border-white/25 ring-2 ring-violet-500/40"
                    : "border-white/[0.08] hover:border-white/15"
                )}
                style={{ background: theme.swatch }}
                title={theme.description}
              >
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-1 text-[8px] font-medium leading-tight text-white/90 backdrop-blur-sm">
                  {theme.label}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
        <p className="text-[10px] text-muted-foreground">
          {CARD_THEMES[activeTheme].description}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Background Texture</SectionLabel>
          <span className="font-mono text-[10px] text-muted-foreground">
            {BACKGROUND_TEXTURES.length} textures
          </span>
        </div>

        <TexturePickerGroup
          label="Pastel & Light"
          textures={LIGHT_BACKGROUND_TEXTURES}
          activeId={backgroundTextureId}
          onSelect={setBackgroundTexture}
        />

        <TexturePickerGroup
          label="Dark & Rich"
          textures={DARK_BACKGROUND_TEXTURES}
          activeId={backgroundTextureId}
          onSelect={setBackgroundTexture}
        />

        <p className="text-[10px] text-muted-foreground">
          {
            BACKGROUND_TEXTURES.find((t) => t.id === backgroundTextureId)
              ?.description
          }
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Spec Card Style</SectionLabel>
          <span className="font-mono text-[10px] text-muted-foreground">
            {SPEC_CARD_STYLES.length} styles
          </span>
        </div>
        <ScrollArea className="h-[200px] rounded-xl border border-white/[0.06] pr-3">
          <div className="grid grid-cols-3 gap-2 p-2">
            {SPEC_CARD_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => setActiveSpecCardStyle(style.id)}
                className={cn(
                  "group relative h-12 overflow-hidden rounded-lg border transition-all",
                  activeSpecCardStyle === style.id
                    ? "border-white/25 ring-2 ring-cyan-500/40"
                    : "border-white/[0.08] hover:border-white/15"
                )}
                style={{ background: style.swatch }}
                title={`${style.label} — ${style.description}`}
              >
                <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[7px] font-medium leading-tight text-white/90 backdrop-blur-sm">
                  {style.label}
                </span>
                {style.category === "borderless" && (
                  <span className="absolute right-1 top-1 rounded bg-black/50 px-1 text-[6px] text-white/70">
                    ∅
                  </span>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
        <p className="text-[10px] text-muted-foreground">
          {
            SPEC_CARD_STYLES.find((s) => s.id === activeSpecCardStyle)
              ?.description
          }
        </p>
      </section>

      <section className="space-y-3">
        <SectionLabel>Spec Layout</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {SPEC_LAYOUTS.map((layout) => {
            const Icon = layout.icon;
            const isActive = specLayout === layout.id;
            return (
              <button
                key={layout.id}
                type="button"
                onClick={() => setSpecLayout(layout.id)}
                className={cn(
                  "flex h-10 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-all",
                  isActive
                    ? "border-violet-500/30 bg-violet-500/10 text-foreground"
                    : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:bg-white/[0.04]"
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.75} />
                {layout.label}
              </button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full gap-2 border-white/[0.08] bg-white/[0.03] text-xs"
          onClick={() => alignSpecCards()}
        >
          <AlignCenter className="size-3.5" />
          Auto-align cards
        </Button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Click card to select · edit in sidebar · drag to move
        </p>
      </section>

      <section className="space-y-3">
        <SectionLabel>Product Image</SectionLabel>
        <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Full placement control — move off-canvas to crop behind card edges.
            Upload your photo in the Photo section.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Horizontal</span>
              <span className="font-mono">
                {Math.round(productX)}%
              </span>
            </div>
            <input
              type="range"
              min={PRODUCT_POSITION_BOUNDS.min}
              max={PRODUCT_POSITION_BOUNDS.max}
              step={0.5}
              value={productX}
              onChange={(e) =>
                setProductPlacement({ x: Number(e.target.value) })
              }
              className="h-1.5 w-full cursor-pointer accent-violet-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Vertical</span>
              <span className="font-mono">
                {Math.round(productY)}%
              </span>
            </div>
            <input
              type="range"
              min={PRODUCT_POSITION_BOUNDS.min}
              max={PRODUCT_POSITION_BOUNDS.max}
              step={0.5}
              value={productY}
              onChange={(e) =>
                setProductPlacement({ y: Number(e.target.value) })
              }
              className="h-1.5 w-full cursor-pointer accent-violet-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Width scale</span>
              <span className="font-mono">
                {Math.round(imageScaleX * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={PRODUCT_SCALE_BOUNDS.min}
              max={PRODUCT_SCALE_BOUNDS.max}
              step={0.02}
              value={imageScaleX}
              onChange={(e) =>
                setImageScale(Number(e.target.value), imageScaleY)
              }
              className="h-1.5 w-full cursor-pointer accent-violet-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Height scale</span>
              <span className="font-mono">
                {Math.round(imageScaleY * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={PRODUCT_SCALE_BOUNDS.min}
              max={PRODUCT_SCALE_BOUNDS.max}
              step={0.02}
              value={imageScaleY}
              onChange={(e) =>
                setImageScale(imageScaleX, Number(e.target.value))
              }
              className="h-1.5 w-full cursor-pointer accent-violet-500"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Tilt / rotation</span>
              <span className="font-mono">{Math.round(imageRotation)}°</span>
            </div>
            <input
              type="range"
              min={PRODUCT_ROTATION_BOUNDS.min}
              max={PRODUCT_ROTATION_BOUNDS.max}
              step={0.5}
              value={imageRotation}
              onChange={(e) => setImageRotation(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-violet-500"
            />
          </div>

          <button
            type="button"
            onClick={toggleProductBehindCards}
            className={cn(
              "flex h-9 w-full items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-all",
              productBehindCards
                ? "border-amber-500/30 bg-amber-500/10 text-foreground"
                : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:bg-white/[0.04]"
            )}
          >
            {productBehindCards ? (
              <>
                <BringToFront className="size-3.5" strokeWidth={1.75} />
                Photo behind cards — bring to front
              </>
            ) : (
              <>
                <SendToBack className="size-3.5" strokeWidth={1.75} />
                Send photo behind cards
              </>
            )}
          </button>

          <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {Math.round(productX)}% · {Math.round(productY)}% ·{" "}
              {Math.round(imageRotation)}°
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={resetProductTransform}
            >
              <RotateCcw className="size-3" />
              Reset
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

function TexturePickerGroup({
  label,
  textures,
  activeId,
  onSelect,
}: {
  label: string;
  textures: BackgroundTexture[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (textures.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {textures.map((texture) => (
          <button
            key={texture.id}
            type="button"
            onClick={() => onSelect(texture.id)}
            className={cn(
              "group relative h-14 overflow-hidden rounded-xl border transition-all",
              activeId === texture.id
                ? texture.tone === "light"
                  ? "border-white/30 ring-2 ring-rose-300/50"
                  : "border-white/25 ring-2 ring-amber-500/40"
                : "border-white/[0.08] hover:border-white/15"
            )}
            style={{ background: texture.swatch }}
            title={`${texture.label} — ${texture.description}`}
          >
            <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-1 text-[8px] font-medium leading-tight text-white/90 backdrop-blur-sm">
              {texture.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
