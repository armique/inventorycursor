"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Copy,
  Layers,
  RotateCcw,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { SectionLabel } from "@/components/layout/section-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePreviewStore } from "@/hooks/use-preview-store";
import {
  hasSpecCardStyleOverrides,
  resolveSpecCardDescStyle,
  resolveSpecCardValueStyle,
  SPEC_TEXT_SIZE_OPTIONS,
  type SpecTextSizeId,
} from "@/lib/spec-card-typography";
import {
  resolveSpecIconType,
  SpecFeatureIcon,
} from "@/preview/components/spec-feature-icon";
import {
  TITLE_COLORS,
  TYPOGRAPHY_PRESETS,
  getTypographyPreset,
  type TitleColorId,
  type TypographyId,
} from "@/themes";
import { getSpecCardStyle } from "@/themes/spec-card-styles";
import { cn } from "@/lib/utils";

function SizePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SpecTextSizeId | null | undefined;
  onChange: (size: SpecTextSizeId | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-4 gap-1">
        {SPEC_TEXT_SIZE_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "h-8 rounded-lg border text-[10px] font-medium transition-all",
              (value ?? null) === option.id
                ? "border-cyan-500/35 bg-cyan-500/10 text-foreground"
                : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:bg-white/[0.04]"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TitleColorId | null | undefined;
  onChange: (colorId: TitleColorId | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          title="Theme default"
          onClick={() => onChange(null)}
          className={cn(
            "h-8 rounded-lg border text-[9px] font-medium transition-all",
            !value
              ? "border-white/30 ring-2 ring-violet-500/40"
              : "border-white/[0.08] hover:border-white/20"
          )}
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.02) 45%)",
          }}
        >
          Auto
        </button>
        {TITLE_COLORS.map((color) => (
          <button
            key={color.id}
            type="button"
            title={color.label}
            onClick={() => onChange(color.id)}
            className={cn(
              "h-8 rounded-lg border transition-all",
              value === color.id
                ? "border-white/30 ring-2 ring-violet-500/40"
                : "border-white/[0.08] hover:border-white/20"
            )}
            style={{ background: color.swatch }}
          />
        ))}
      </div>
    </div>
  );
}

export function SpecCardInspector() {
  const selectedCardUid = usePreviewStore((s) => s.selectedCardUid);
  const specCards = usePreviewStore((s) => s.specCards);
  const typographyId = usePreviewStore((s) => s.typographyId);
  const activeSpecCardStyle = usePreviewStore((s) => s.activeSpecCardStyle);
  const updateSpecCard = usePreviewStore((s) => s.updateSpecCard);
  const resetSpecCardStyles = usePreviewStore((s) => s.resetSpecCardStyles);
  const applySpecCardStylesToAll = usePreviewStore(
    (s) => s.applySpecCardStylesToAll
  );
  const promoteCardTypographyToGlobal = usePreviewStore(
    (s) => s.promoteCardTypographyToGlobal
  );
  const duplicateSpecCard = usePreviewStore((s) => s.duplicateSpecCard);
  const deleteSpecCard = usePreviewStore((s) => s.deleteSpecCard);
  const selectSpecCard = usePreviewStore((s) => s.selectSpecCard);

  const valueInputRef = useRef<HTMLInputElement>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedCard = specCards.find((c) => c.uid === selectedCardUid) ?? null;
  const cardStyle = getSpecCardStyle(activeSpecCardStyle);

  useEffect(() => {
    if (!selectedCardUid) return;
    const t = window.setTimeout(() => valueInputRef.current?.focus(), 220);
    return () => window.clearTimeout(t);
  }, [selectedCardUid]);

  useEffect(() => {
    if (!actionMessage) return;
    const t = window.setTimeout(() => setActionMessage(null), 2400);
    return () => window.clearTimeout(t);
  }, [actionMessage]);

  const showAction = (message: string) => setActionMessage(message);

  if (!selectedCard) {
    return (
      <div className="space-y-2 rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.015] p-4">
        <SectionLabel>Spec Card</SectionLabel>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Click any spec card on the preview to edit text, font, size and colors
          here.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <Layers className="size-4 shrink-0 text-violet-400/60" strokeWidth={1.75} />
          <span className="text-[10px] text-muted-foreground">
            {specCards.length} cards on canvas · none selected
          </span>
        </div>
      </div>
    );
  }

  const iconType = resolveSpecIconType(selectedCard.id, selectedCard.icon);
  const effectiveTypographyId = selectedCard.typographyId ?? typographyId;
  const effectiveTypography = getTypographyPreset(effectiveTypographyId);
  const valueStyle = resolveSpecCardValueStyle(selectedCard, typographyId);
  const descStyle = resolveSpecCardDescStyle(selectedCard, typographyId);
  const hasOverrides = hasSpecCardStyleOverrides(selectedCard);

  const setTypography = (id: TypographyId | null) => {
    updateSpecCard(selectedCard.uid, { typographyId: id });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SectionLabel>Spec Card</SectionLabel>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Text, font, size & color for this card
          </p>
        </div>
        <button
          type="button"
          title="Deselect"
          onClick={() => selectSpecCard(null)}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {actionMessage && (
        <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] px-2.5 py-2 text-[10px] text-emerald-200/90">
          {actionMessage}
        </p>
      )}

      <div
        className={cn("relative mx-auto overflow-hidden", cardStyle.className)}
        style={{
          width: 128,
          height: 104,
          borderRadius: "var(--sc-radius)",
          background: "var(--sc-bg)",
          borderWidth: "var(--sc-border-width)",
          borderStyle: "solid",
          borderColor: "rgba(139,92,246,0.35)",
          boxShadow: "var(--sc-shadow)",
          ...(cardStyle.vars as CSSProperties),
        }}
      >
        <div className="flex h-full items-center gap-2.5 px-2.5 py-2">
          <div
            className="flex shrink-0 items-center justify-center border"
            style={{
              width: "var(--sc-icon-size)",
              height: "var(--sc-icon-size)",
              borderRadius: "var(--sc-icon-radius)",
              borderColor: "var(--sc-icon-border)",
              background: "var(--sc-icon-bg)",
              color: "var(--t-badge-icon)",
            }}
          >
            <SpecFeatureIcon type={iconType} size={20} className="opacity-95" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate leading-tight" style={valueStyle}>
              {selectedCard.value || "Value"}
            </p>
            <p className="mt-0.5 truncate leading-tight" style={descStyle}>
              {selectedCard.description || "Description"}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="spec-card-value" className="text-xs text-muted-foreground">
          Value
        </Label>
        <Input
          ref={valueInputRef}
          id="spec-card-value"
          value={selectedCard.value}
          onChange={(e) =>
            updateSpecCard(selectedCard.uid, { value: e.target.value })
          }
          className="h-10 border-white/[0.08] bg-white/[0.03] text-sm"
          placeholder="i7-12700K"
        />
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="spec-card-description"
          className="text-xs text-muted-foreground"
        >
          Description
        </Label>
        <Input
          id="spec-card-description"
          value={selectedCard.description}
          onChange={(e) =>
            updateSpecCard(selectedCard.uid, { description: e.target.value })
          }
          className="h-9 border-white/[0.08] bg-white/[0.03] text-xs"
          placeholder="12C • 20T"
        />
      </div>

      <div className="space-y-2">
        <SectionLabel>Card Font</SectionLabel>
        <p className="text-[10px] text-muted-foreground">
          {selectedCard.typographyId
            ? `Override: ${effectiveTypography.label}`
            : `Global: ${effectiveTypography.label}`}
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            onClick={() => setTypography(null)}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-left transition-all",
              !selectedCard.typographyId
                ? "border-cyan-500/35 bg-cyan-500/10"
                : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
            )}
          >
            <span className="text-[10px] font-medium text-foreground/90">
              Use global typography
            </span>
          </button>
          {TYPOGRAPHY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setTypography(preset.id)}
              className={cn(
                "flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-all",
                selectedCard.typographyId === preset.id
                  ? "border-cyan-500/35 bg-cyan-500/10"
                  : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
              )}
            >
              <span
                className="truncate text-[11px] font-semibold text-foreground/90"
                style={{ fontFamily: preset.family }}
              >
                {preset.label}
              </span>
              <span
                className="ml-2 shrink-0 text-base font-bold text-muted-foreground"
                style={{ fontFamily: preset.family }}
              >
                {preset.sample}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <SizePicker
          label="Value size"
          value={selectedCard.valueSize}
          onChange={(size) =>
            updateSpecCard(selectedCard.uid, { valueSize: size })
          }
        />
        <SizePicker
          label="Description size"
          value={selectedCard.descSize}
          onChange={(size) =>
            updateSpecCard(selectedCard.uid, { descSize: size })
          }
        />
      </div>

      <ColorPicker
        label="Value color"
        value={selectedCard.valueColorId}
        onChange={(colorId) =>
          updateSpecCard(selectedCard.uid, { valueColorId: colorId })
        }
      />

      <ColorPicker
        label="Description color"
        value={selectedCard.descColorId}
        onChange={(colorId) =>
          updateSpecCard(selectedCard.uid, { descColorId: colorId })
        }
      />

      <div className="grid grid-cols-1 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            applySpecCardStylesToAll(selectedCard.uid);
            showAction(`Styles applied to all ${specCards.length} cards`);
          }}
          className="h-9 gap-1.5 border-cyan-500/20 bg-cyan-500/[0.06] text-xs text-cyan-100 hover:bg-cyan-500/10"
        >
          <Layers className="size-3.5" strokeWidth={1.75} />
          Apply styles to all cards
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            promoteCardTypographyToGlobal(selectedCard.uid);
            showAction(
              `${effectiveTypography.label} set as global card typography`
            );
          }}
          className="h-9 gap-1.5 border-white/[0.08] bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <Type className="size-3.5" strokeWidth={1.75} />
          Set font as global default
        </Button>
      </div>

      {hasOverrides && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            resetSpecCardStyles(selectedCard.uid);
            showAction("Card styles reset to global");
          }}
          className="h-9 w-full gap-1.5 border-white/[0.08] bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <RotateCcw className="size-3.5" strokeWidth={1.75} />
          Reset styles to global
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => duplicateSpecCard(selectedCard.uid)}
          className="h-9 gap-1.5 border-white/[0.08] bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <Copy className="size-3.5" strokeWidth={1.75} />
          Duplicate
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => deleteSpecCard(selectedCard.uid)}
          className="h-9 gap-1.5 border-red-500/20 bg-red-500/[0.06] text-xs text-red-300 hover:bg-red-500/10"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
          Delete
        </Button>
      </div>
    </div>
  );
}
