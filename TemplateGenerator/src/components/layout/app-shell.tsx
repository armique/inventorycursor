"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { EditorSidebar } from "@/editor/editor-sidebar";
import { PreviewCanvas } from "@/preview/preview-canvas";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function AppShell() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-app">
      <motion.aside
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex h-full w-[420px] shrink-0 flex-col p-4"
      >
        <Card
          className={cn(
            "flex h-full flex-col overflow-hidden rounded-[24px]",
            "border-white/[0.08] bg-white/[0.03]",
            "shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)]",
            "backdrop-blur-2xl backdrop-saturate-150"
          )}
        >
          <header className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
            <div className="flex size-9 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-400/25">
              <Sparkles className="size-4 text-violet-400" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                {APP_NAME}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                Dashboard
              </p>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1">
              <span className="font-mono text-[10px] text-emerald-400/80">LIVE</span>
            </div>
          </header>

          <EditorSidebar />
        </Card>
      </motion.aside>

      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="relative flex min-w-0 flex-1 flex-col"
      >
        <PreviewCanvas />
      </motion.main>
    </div>
  );
}
