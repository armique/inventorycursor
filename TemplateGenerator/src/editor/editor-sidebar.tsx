"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PreviewControls } from "@/editor/preview-controls";
import { StylePresetPicker } from "@/editor/style-preset-picker";
import { ProductPhotoUpload } from "@/editor/product-photo-upload";
import { ProductTitleEditor } from "@/editor/product-title-editor";
import { SpecCardInspector } from "@/editor/spec-card-inspector";
import {
  resolveSidebarActiveSection,
  SidebarNav,
  type SidebarNavSectionId,
} from "@/editor/sidebar-nav";
import { SidebarSection, scrollSidebarToSection } from "@/editor/sidebar-section";
import {
  Download,
  Monitor,
} from "lucide-react";

import { SectionLabel } from "@/components/layout/section-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { usePreviewStore } from "@/hooks/use-preview-store";
import {
  MOCK_ADDITIONAL_SPECS,
  MOCK_MAIN_SPECS,
  MOCK_PROJECT,
} from "@/lib/constants";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE_OUT },
  },
};

export function EditorSidebar() {
  const selectedCardUid = usePreviewStore((s) => s.selectedCardUid);
  const isProductSelected = usePreviewStore((s) => s.isProductSelected);
  const [pinnedSection, setPinnedSection] = useState<SidebarNavSectionId | null>(
    null
  );

  const activeSection = resolveSidebarActiveSection({
    selectedCardUid,
    isProductSelected,
    pinnedSection,
  });

  useEffect(() => {
    if (selectedCardUid) {
      scrollSidebarToSection("spec-card-inspector");
      return;
    }
    if (isProductSelected) {
      scrollSidebarToSection("sidebar-product-photo");
    }
  }, [selectedCardUid, isProductSelected]);

  useEffect(() => {
    if (activeSection === "spec-card-inspector" || activeSection === "sidebar-product-photo") {
      setPinnedSection(null);
    }
  }, [activeSection]);

  const handleNavigate = (sectionId: SidebarNavSectionId) => {
    setPinnedSection(sectionId);
  };

  return (
    <ScrollArea className="flex-1">
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="space-y-6 p-5"
      >
        <motion.div variants={fadeUp}>
          <SidebarNav
            activeSection={activeSection}
            onNavigate={handleNavigate}
          />
        </motion.div>

        <Separator className="bg-white/[0.06]" />

        <motion.div variants={fadeUp}>
          <StylePresetPicker />
        </motion.div>

        <Separator className="bg-white/[0.06]" />

        <motion.section variants={fadeUp} className="space-y-3">
          <SectionLabel>Project</SectionLabel>
          <div className="space-y-2">
            <Label htmlFor="project-name" className="text-xs text-muted-foreground">
              Template name
            </Label>
            <Input
              id="project-name"
              defaultValue={MOCK_PROJECT.name}
              readOnly
              className="h-10 border-white/[0.08] bg-white/[0.03] text-sm"
            />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Monitor className="size-3.5" strokeWidth={1.75} />
            <span>1600 × 1600 · Square 1:1</span>
          </div>
        </motion.section>

        <Separator className="bg-white/[0.06]" />

        <motion.div variants={fadeUp}>
          <SidebarSection
            id="sidebar-preview"
            active={activeSection === "sidebar-preview"}
            className="p-1"
          >
            <PreviewControls />
          </SidebarSection>
        </motion.div>

        <motion.div variants={fadeUp}>
          <SidebarSection
            id="spec-card-inspector"
            active={activeSection === "spec-card-inspector"}
          >
            <SpecCardInspector />
          </SidebarSection>
        </motion.div>

        <Separator className="bg-white/[0.06]" />

        <motion.div variants={fadeUp}>
          <SidebarSection
            id="sidebar-product-title"
            active={activeSection === "sidebar-product-title"}
            className="space-y-3 p-1"
          >
            <SectionLabel>Product Title</SectionLabel>
            <ProductTitleEditor />
          </SidebarSection>
        </motion.div>

        <Separator className="bg-white/[0.06]" />

        <motion.div variants={fadeUp}>
          <SidebarSection
            id="sidebar-product-photo"
            active={activeSection === "sidebar-product-photo"}
            className="space-y-3 p-1"
          >
            <SectionLabel>Product Photo</SectionLabel>
            <ProductPhotoUpload />
          </SidebarSection>
        </motion.div>

        <Separator className="bg-white/[0.06]" />

        <motion.section variants={fadeUp} className="space-y-3">
          <SectionLabel>Main Specs</SectionLabel>
          <Textarea
            defaultValue={MOCK_MAIN_SPECS}
            readOnly
            rows={4}
            className="resize-none border-white/[0.08] bg-white/[0.03] text-xs leading-relaxed"
          />
        </motion.section>

        <Separator className="bg-white/[0.06]" />

        <motion.section variants={fadeUp} className="space-y-3">
          <SectionLabel>Additional Specs</SectionLabel>
          <Textarea
            defaultValue={MOCK_ADDITIONAL_SPECS}
            readOnly
            rows={3}
            className="resize-none border-white/[0.08] bg-white/[0.03] text-xs leading-relaxed"
          />
        </motion.section>

        <Separator className="bg-white/[0.06]" />

        <motion.section variants={fadeUp} className="space-y-3 pb-2">
          <SectionLabel>Export</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-10 border-white/[0.08] bg-white/[0.03] text-xs hover:bg-white/[0.06]"
            >
              PNG
            </Button>
            <Button
              variant="outline"
              className="h-10 border-white/[0.08] bg-white/[0.03] text-xs hover:bg-white/[0.06]"
            >
              JPEG
            </Button>
          </div>
          <Button className="h-11 w-full gap-2 bg-violet-600 text-sm hover:bg-violet-500">
            <Download className="size-4" strokeWidth={1.75} />
            Export Template
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            1600 × 1600 · Square · 2× retina
          </p>
        </motion.section>
      </motion.div>
    </ScrollArea>
  );
}
