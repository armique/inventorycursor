"use client";

import { Check, Sparkles } from "lucide-react";

import { SectionLabel } from "@/components/layout/section-label";
import { usePreviewStore } from "@/hooks/use-preview-store";
import { STYLE_PRESETS } from "@/themes";
import { cn } from "@/lib/utils";

export function StylePresetPicker() {
  const activePresetId = usePreviewStore((s) => s.activePresetId);
  const applyStylePreset = usePreviewStore((s) => s.applyStylePreset);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>Style Presets</SectionLabel>
        <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Sparkles className="size-3" strokeWidth={1.75} />
          {STYLE_PRESETS.length} looks
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {STYLE_PRESETS.map((preset) => {
          const isActive = activePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyStylePreset(preset.id)}
              className={cn(
                "group relative flex h-20 flex-col justify-end overflow-hidden rounded-xl border p-2 text-left transition-all",
                isActive
                  ? "border-white/30 ring-2 ring-violet-500/50"
                  : "border-white/[0.08] hover:border-white/20"
              )}
              style={{ background: preset.swatch }}
              title={preset.description}
            >
              <span className="absolute right-1.5 top-1.5 font-mono text-[9px] font-semibold text-white/70 mix-blend-difference">
                {preset.index}
              </span>

              {isActive && (
                <span className="absolute left-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-violet-500 text-white">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}

              <span className="relative rounded-md bg-black/45 px-1.5 py-1 backdrop-blur-sm">
                <span className="block text-[10px] font-semibold leading-tight text-white">
                  {preset.label}
                </span>
                <span className="mt-0.5 block truncate text-[8px] leading-tight text-white/70">
                  {preset.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        One-click complete looks — sets background, card style, layout, fonts
        and colors together. Fine-tune anything below afterwards.
      </p>
    </section>
  );
}
