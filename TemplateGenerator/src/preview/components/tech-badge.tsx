"use client";

import { motion } from "framer-motion";

import {
  resolveSpecIconType,
  SpecFeatureIcon,
} from "@/preview/components/spec-feature-icon";
import type { TechBadgeData } from "@/types/template";

type TechBadgeProps = {
  data: TechBadgeData;
  index: number;
};

export function TechBadge({ data, index }: TechBadgeProps) {
  const iconType = resolveSpecIconType(data.id, data.icon);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 + index * 0.035, duration: 0.32 }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 backdrop-blur-sm"
      style={{
        background: "var(--t-badge-bg)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: "var(--t-badge-border)",
        boxShadow:
          index % 2 === 0
            ? "0 0 14px -5px rgba(var(--t-glow-primary), 0.2)"
            : "0 0 14px -5px rgba(var(--t-glow-secondary), 0.15)",
      }}
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center"
        style={{ color: "var(--t-badge-icon)" }}
      >
        <SpecFeatureIcon type={iconType} size={16} className="opacity-95" />
      </span>
      <span
        className="text-[clamp(7.5px,0.85vw,10.5px)] font-medium"
        style={{
          color: "var(--t-badge-text)",
          fontFamily: "inherit",
          letterSpacing: "var(--t-letter-spacing)",
          fontWeight: "var(--t-font-weight)",
        }}
      >
        {data.label}
      </span>
    </motion.div>
  );
}
