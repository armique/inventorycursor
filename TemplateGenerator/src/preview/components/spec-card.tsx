"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";

import { EASE_OUT } from "@/lib/motion";
import {
  resolveSpecCardDescStyle,
  resolveSpecCardValueStyle,
} from "@/lib/spec-card-typography";
import { SPEC_CARD_SIZE } from "@/lib/spec-cards";
import { getSpecCardStyle } from "@/themes/spec-card-styles";
import { cn } from "@/lib/utils";
import type { EditableSpecCard } from "@/lib/spec-cards";
import {
  resolveSpecIconType,
  SpecFeatureIcon,
} from "@/preview/components/spec-feature-icon";
import { usePreviewStore } from "@/hooks/use-preview-store";

type SpecCardProps = {
  data: EditableSpecCard;
  align: "left" | "right" | "center";
  isSelected?: boolean;
  delay?: number;
};

export function SpecCard({
  data,
  align,
  isSelected = false,
  delay = 0,
}: SpecCardProps) {
  const activeSpecCardStyle = usePreviewStore((s) => s.activeSpecCardStyle);
  const typographyId = usePreviewStore((s) => s.typographyId);
  const iconOnly = usePreviewStore((s) => s.iconOnlyCards);
  const cardStyle = getSpecCardStyle(activeSpecCardStyle);
  const iconType = resolveSpecIconType(data.id, data.icon);
  const isHorizontal = align !== "center";
  const valueStyle = resolveSpecCardValueStyle(data, typographyId);
  const descStyle = resolveSpecCardDescStyle(data, typographyId);

  const accentGradient =
    align === "left"
      ? `linear-gradient(90deg, var(--t-spec-accent-l), transparent)`
      : align === "right"
        ? `linear-gradient(270deg, var(--t-spec-accent-r), transparent)`
        : `linear-gradient(180deg, var(--t-spec-accent-l), transparent)`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: EASE_OUT }}
      className={cn(
        "relative overflow-hidden transition-shadow",
        cardStyle.className,
        isSelected && "ring-2 ring-violet-400/50"
      )}
      style={{
        ...(cardStyle.vars as CSSProperties),
        width: iconOnly ? SPEC_CARD_SIZE.height : SPEC_CARD_SIZE.width,
        height: SPEC_CARD_SIZE.height,
        borderRadius: iconOnly ? "999px" : "var(--sc-radius)",
        backdropFilter: "var(--sc-backdrop)",
        WebkitBackdropFilter: "var(--sc-backdrop)",
        background: "var(--sc-bg)",
        borderWidth: "var(--sc-border-width)",
        borderStyle: cardStyle.className?.includes("dashed") ? "dashed" : "solid",
        borderColor: isSelected ? "rgba(139,92,246,0.45)" : "var(--sc-border)",
        boxShadow: "var(--sc-shadow)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: cardStyle.vars["--sc-accent"] ?? accentGradient,
        }}
      />

      <div
        className={cn(
          "relative flex h-full px-2.5 py-2",
          iconOnly
            ? "items-center justify-center"
            : isHorizontal
              ? "items-center gap-2.5"
              : "flex-col items-center justify-center gap-2",
          !iconOnly && isHorizontal && align === "right" && "flex-row-reverse"
        )}
      >
        <div
          className="flex shrink-0 items-center justify-center border"
          style={{
            width: iconOnly ? "calc(var(--sc-icon-size) + 8px)" : "var(--sc-icon-size)",
            height: iconOnly ? "calc(var(--sc-icon-size) + 8px)" : "var(--sc-icon-size)",
            borderRadius: iconOnly ? "999px" : "var(--sc-icon-radius)",
            borderColor: "var(--sc-icon-border)",
            background: "var(--sc-icon-bg)",
            color: "var(--t-badge-icon)",
          }}
        >
          <SpecFeatureIcon type={iconType} size={iconOnly ? 26 : 20} className="opacity-95" />
        </div>

        {!iconOnly && (
          <div
            className={cn(
              "min-w-0 flex-1",
              align === "left" && "text-left",
              align === "right" && "text-right",
              align === "center" && "text-center"
            )}
          >
            <p className="truncate leading-tight" style={valueStyle}>
              {data.value}
            </p>
            <p className="mt-0.5 truncate leading-tight" style={descStyle}>
              {data.description}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
