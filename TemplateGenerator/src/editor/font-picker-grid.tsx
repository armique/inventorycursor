"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { TITLE_FONTS, type TitleFontId } from "@/themes";
import { cn } from "@/lib/utils";

type FontPickerGridProps = {
  value: TitleFontId | null;
  onChange: (id: TitleFontId | null) => void;
  className?: string;
};

export function FontPickerGrid({ value, onChange, className }: FontPickerGridProps) {
  return (
    <ScrollArea className={cn("h-36 rounded-xl border border-white/[0.06]", className)}>
      <div className="grid grid-cols-2 gap-1.5 p-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "rounded-lg border px-2 py-2 text-left transition-all",
            value === null
              ? "border-violet-500/35 bg-violet-500/10"
              : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
          )}
        >
          <span className="block text-[10px] font-medium text-foreground/90">
            Style default
          </span>
          <span className="mt-0.5 block text-[9px] text-muted-foreground">
            From Title Style preset
          </span>
        </button>

        {TITLE_FONTS.map((font) => (
          <button
            key={font.id}
            type="button"
            onClick={() => onChange(font.id)}
            className={cn(
              "rounded-lg border px-2 py-2 text-left transition-all",
              value === font.id
                ? "border-violet-500/35 bg-violet-500/10"
                : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
            )}
          >
            <span
              className="block truncate text-[10px] font-semibold text-foreground/90"
              style={{ fontFamily: font.family }}
            >
              {font.label}
            </span>
            <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
              {font.usedBy ?? font.sample}
            </span>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
