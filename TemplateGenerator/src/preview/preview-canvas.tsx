"use client";

import { motion } from "framer-motion";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MOCK_PRODUCT_CARD, PREVIEW_CANVAS } from "@/lib/constants";
import { scaleIn } from "@/lib/motion";
import { getLayoutComponent } from "@/preview/layouts";
import { usePreviewStore } from "@/hooks/use-preview-store";
import { CARD_THEMES } from "@/themes";

export function PreviewCanvas() {
  const activeTheme = usePreviewStore((s) => s.activeTheme);
  const LayoutComponent = getLayoutComponent("gaming-hero");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium text-white/70">Live Preview</span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-white/35">
            {CARD_THEMES[activeTheme].label}
          </span>
        </div>
        <span className="font-mono text-[10px] text-white/35">
          {PREVIEW_CANVAS.width} × {PREVIEW_CANVAS.height}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-5 lg:p-8">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 35% 45%, rgba(139,92,246,0.08), transparent 45%),
              radial-gradient(circle at 65% 55%, rgba(59,130,246,0.06), transparent 45%)
            `,
          }}
        />

        <motion.div
          variants={scaleIn}
          initial="hidden"
          animate="show"
          className="relative aspect-square w-full max-w-[min(100%,720px)]"
        >
          <LayoutComponent data={MOCK_PRODUCT_CARD} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="absolute bottom-5 right-5 flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#0d1220]/80 p-1 backdrop-blur-xl"
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <ZoomOut className="size-3.5" strokeWidth={1.75} />
          </Button>
          <span className="min-w-[3rem] text-center font-mono text-xs text-white/50">
            68%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <ZoomIn className="size-3.5" strokeWidth={1.75} />
          </Button>
          <div className="mx-1 h-4 w-px bg-white/[0.08]" />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <Maximize2 className="size-3.5" strokeWidth={1.75} />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
