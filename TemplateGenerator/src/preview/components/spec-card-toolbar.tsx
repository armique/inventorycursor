"use client";

import { Copy, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

type SpecCardToolbarProps = {
  onDuplicate: () => void;
  onDelete: () => void;
  className?: string;
};

export function SpecCardToolbar({
  onDuplicate,
  onDelete,
  className,
}: SpecCardToolbarProps) {
  return (
    <div
      className={cn(
        "absolute -top-9 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1",
        "rounded-lg border border-white/15 bg-[#0d1220]/90 p-0.5 shadow-lg backdrop-blur-md",
        className
      )}
    >
      <button
        type="button"
        title="Duplicate"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        className="flex size-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Copy className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex size-7 items-center justify-center rounded-md text-red-400/80 transition-colors hover:bg-red-500/15 hover:text-red-300"
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
