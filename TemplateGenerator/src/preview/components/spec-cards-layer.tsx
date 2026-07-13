"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";

import { SpecCard } from "@/preview/components/spec-card";
import { SpecCardToolbar } from "@/preview/components/spec-card-toolbar";
import { usePreviewStore } from "@/hooks/use-preview-store";
import { fadeUp, stagger } from "@/lib/motion";
import { getAlignForPlacement } from "@/lib/spec-layout";

const DRAG_THRESHOLD = 5;

export function SpecCardsLayer() {
  const specLayout = usePreviewStore((s) => s.specLayout);
  const specCards = usePreviewStore((s) => s.specCards);
  const specPlacements = usePreviewStore((s) => s.specPlacements);
  const selectedCardUid = usePreviewStore((s) => s.selectedCardUid);
  const setSpecPlacement = usePreviewStore((s) => s.setSpecPlacement);
  const selectSpecCard = usePreviewStore((s) => s.selectSpecCard);
  const duplicateSpecCard = usePreviewStore((s) => s.duplicateSpecCard);
  const deleteSpecCard = usePreviewStore((s) => s.deleteSpecCard);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    uid: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (uid: string) => (e: React.PointerEvent) => {
      const placement = specPlacements[uid];
      if (!placement) return;

      selectSpecCard(uid);
      dragRef.current = {
        uid,
        startX: e.clientX,
        startY: e.clientY,
        originX: placement.x,
        originY: placement.y,
        dragging: false,
      };
    },
    [specPlacements, selectSpecCard]
  );

  const setSpecPlacementRef = useRef(setSpecPlacement);
  setSpecPlacementRef.current = setSpecPlacement;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const { uid, startX, startY, originX, originY, dragging } =
        dragRef.current;

      const dxPx = e.clientX - startX;
      const dyPx = e.clientY - startY;

      if (!dragging) {
        if (Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD) return;
        dragRef.current.dragging = true;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const dx = (dxPx / rect.width) * 100;
      const dy = (dyPx / rect.height) * 100;
      setSpecPlacementRef.current(uid, { x: originX + dx, y: originY + dy });
    };

    const onUp = () => {
      dragRef.current = null;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onPointerUp = useCallback(
    (uid: string) => () => {
      if (!dragRef.current || dragRef.current.uid !== uid) return;
      dragRef.current = null;
    },
    []
  );

  return (
    <motion.div
      ref={containerRef}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="pointer-events-none absolute inset-0 z-[6]"
    >
      {specCards.map((card, i) => {
        const placement = specPlacements[card.uid];
        if (!placement) return null;

        const align = getAlignForPlacement(specLayout, placement.x);
        const isSelected = selectedCardUid === card.uid;

        return (
          <div
            key={card.uid}
            className="pointer-events-auto absolute touch-none"
            style={{
              left: `${placement.x}%`,
              top: `${placement.y}%`,
              transform: "translate(-50%, -50%)",
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown(card.uid)}
            onPointerUp={onPointerUp(card.uid)}
          >
            <motion.div variants={fadeUp}>
              {isSelected && (
                <SpecCardToolbar
                  onDuplicate={() => duplicateSpecCard(card.uid)}
                  onDelete={() => deleteSpecCard(card.uid)}
                />
              )}

              <div className="cursor-grab active:cursor-grabbing">
                <SpecCard
                  data={card}
                  align={align}
                  isSelected={isSelected}
                  delay={0.12 + i * 0.03}
                />
              </div>
            </motion.div>
          </div>
        );
      })}
    </motion.div>
  );
}
