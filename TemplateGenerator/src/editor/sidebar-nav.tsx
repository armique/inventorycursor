"use client";

import {
  ImageIcon,
  LayoutGrid,
  Layers,
  Type,
} from "lucide-react";

import { usePreviewStore } from "@/hooks/use-preview-store";
import { scrollSidebarToSection } from "@/editor/sidebar-section";
import { cn } from "@/lib/utils";

export type SidebarNavSectionId =
  | "sidebar-preview"
  | "spec-card-inspector"
  | "sidebar-product-title"
  | "sidebar-product-photo";

const NAV_ITEMS: {
  id: SidebarNavSectionId;
  label: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: "sidebar-preview", label: "Layout", icon: LayoutGrid },
  { id: "spec-card-inspector", label: "Card", icon: Layers },
  { id: "sidebar-product-title", label: "Title", icon: Type },
  { id: "sidebar-product-photo", label: "Photo", icon: ImageIcon },
];

type SidebarNavProps = {
  activeSection: SidebarNavSectionId | null;
  onNavigate: (sectionId: SidebarNavSectionId) => void;
};

export function SidebarNav({ activeSection, onNavigate }: SidebarNavProps) {
  const selectedCardUid = usePreviewStore((s) => s.selectedCardUid);

  return (
    <nav
      aria-label="Sidebar sections"
      className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1.5"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = activeSection === item.id;
        const needsCard = item.id === "spec-card-inspector";
        const isMuted = needsCard && !selectedCardUid;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              scrollSidebarToSection(item.id);
              onNavigate(item.id);
            }}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center transition-all",
              isActive
                ? "bg-violet-500/15 text-violet-200"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              isMuted && !isActive && "opacity-60"
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            <span className="text-[9px] font-medium leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function resolveSidebarActiveSection(input: {
  selectedCardUid: string | null;
  isProductSelected: boolean;
  pinnedSection: SidebarNavSectionId | null;
}): SidebarNavSectionId | null {
  if (input.selectedCardUid) return "spec-card-inspector";
  if (input.isProductSelected) return "sidebar-product-photo";
  return input.pinnedSection;
}
