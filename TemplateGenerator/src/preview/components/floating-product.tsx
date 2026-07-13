"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { ImagePlus, RotateCw } from "lucide-react";

import { usePreviewStore } from "@/hooks/use-preview-store";
import { EASE_OUT } from "@/lib/motion";
import {
  hasProductImage,
  PRODUCT_BASE_WIDTH,
  PRODUCT_MAX_WIDTH,
} from "@/lib/product-image";
import { cn } from "@/lib/utils";

const DRAG_THRESHOLD = 4;

type DragMode =
  | "move"
  | "resize-se"
  | "resize-e"
  | "resize-s"
  | "rotate"
  | null;

type DragState = {
  mode: Exclude<DragMode, null>;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originScaleX: number;
  originScaleY: number;
  originRotation: number;
  centerX: number;
  centerY: number;
  startAngle: number;
  dragging: boolean;
};

export function FloatingProduct() {
  const productImageSrc = usePreviewStore((s) => s.productImageSrc);
  const productX = usePreviewStore((s) => s.productX);
  const productY = usePreviewStore((s) => s.productY);
  const imageScaleX = usePreviewStore((s) => s.imageScaleX);
  const imageScaleY = usePreviewStore((s) => s.imageScaleY);
  const imageRotation = usePreviewStore((s) => s.imageRotation);
  const isProductSelected = usePreviewStore((s) => s.isProductSelected);
  const setProductPlacement = usePreviewStore((s) => s.setProductPlacement);
  const setImageScale = usePreviewStore((s) => s.setImageScale);
  const setImageRotation = usePreviewStore((s) => s.setImageRotation);
  const selectProduct = usePreviewStore((s) => s.selectProduct);
  const clearSelection = usePreviewStore((s) => s.clearSelection);

  const containerRef = useRef<HTMLDivElement>(null);
  const productRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const placementRef = useRef({
    productX,
    productY,
    imageScaleX,
    imageScaleY,
    imageRotation,
  });
  const setProductPlacementRef = useRef(setProductPlacement);
  const setImageScaleRef = useRef(setImageScale);
  const setImageRotationRef = useRef(setImageRotation);

  placementRef.current = {
    productX,
    productY,
    imageScaleX,
    imageScaleY,
    imageRotation,
  };
  setProductPlacementRef.current = setProductPlacement;
  setImageScaleRef.current = setImageScale;
  setImageRotationRef.current = setImageRotation;

  const hasImage = hasProductImage(productImageSrc);
  const isBlob = productImageSrc?.startsWith("blob:") ?? false;

  const getProductCenter = useCallback(() => {
    const rect = productRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const state = dragRef.current;
      const {
        mode,
        startX,
        startY,
        originX,
        originY,
        originScaleX,
        originScaleY,
        originRotation,
        centerX,
        centerY,
        startAngle,
        dragging,
      } = state;

      const dxPx = e.clientX - startX;
      const dyPx = e.clientY - startY;

      if (mode === "move" && !dragging) {
        if (Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD) return;
        dragRef.current.dragging = true;
      }

      if (mode === "rotate") {
        const angle =
          (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) /
          Math.PI;
        setImageRotationRef.current(originRotation + (angle - startAngle));
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();

      if (mode === "move") {
        const dx = (dxPx / rect.width) * 100;
        const dy = (dyPx / rect.height) * 100;
        setProductPlacementRef.current({ x: originX + dx, y: originY + dy });
        return;
      }

      const dx = dxPx / 180;
      const dy = dyPx / 180;

      if (mode === "resize-se") {
        setImageScaleRef.current(originScaleX + dx, originScaleY + dy);
      } else if (mode === "resize-e") {
        setImageScaleRef.current(originScaleX + dx, originScaleY);
      } else if (mode === "resize-s") {
        setImageScaleRef.current(originScaleX, originScaleY + dy);
      }
    };

    const onUp = () => endDrag();

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [endDrag]);

  const onPointerDown = useCallback(
    (mode: Exclude<DragMode, null>) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectProduct();

      const { productX, productY, imageScaleX, imageScaleY, imageRotation } =
        placementRef.current;
      const center = getProductCenter();
      const startAngle =
        (Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180) /
        Math.PI;

      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        originX: productX,
        originY: productY,
        originScaleX: imageScaleX,
        originScaleY: imageScaleY,
        originRotation: imageRotation,
        centerX: center.x,
        centerY: center.y,
        startAngle,
        dragging: mode !== "move",
      };
    },
    [selectProduct, getProductCenter]
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-0",
        isProductSelected ? "z-[8]" : "z-[5]"
      )}
      onClick={() => clearSelection()}
    >
      <div
        className="absolute"
        style={{
          left: `${productX}%`,
          top: `${productY}%`,
          width: `${PRODUCT_BASE_WIDTH}%`,
          maxWidth: PRODUCT_MAX_WIDTH,
          aspectRatio: "4 / 5",
          transform: "translate(-50%, -50%)",
        }}
      >
        <motion.div
          ref={productRef}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.75, ease: EASE_OUT }}
          className="group relative h-full w-full"
          style={{
            transform: `scaleX(${imageScaleX}) scaleY(${imageScaleY}) rotate(${imageRotation}deg)`,
            transformOrigin: "center center",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            role="button"
            tabIndex={0}
            onPointerDown={onPointerDown("move")}
            className={cn(
              "relative h-full w-full touch-none",
              "cursor-grab active:cursor-grabbing",
              isProductSelected &&
                "rounded-2xl ring-2 ring-violet-400/45 ring-offset-2 ring-offset-transparent",
              !hasImage &&
                "rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.03]"
            )}
          >
            {hasImage ? (
              <>
                <div
                  className="pointer-events-none absolute left-1/2 top-[72%] -translate-x-1/2"
                  style={{
                    width: "72%",
                    height: "12%",
                    borderRadius: "50%",
                    background:
                      "radial-gradient(ellipse, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.12) 45%, transparent 72%)",
                    filter: "blur(18px)",
                  }}
                />

                <div
                  className="pointer-events-none absolute left-1/2 top-[58%] -translate-x-1/2"
                  style={{
                    width: "90%",
                    height: "35%",
                    background: `radial-gradient(ellipse at center, rgba(var(--t-glow-primary), 0.28) 0%, rgba(var(--t-glow-secondary), 0.14) 40%, transparent 72%)`,
                    filter: "blur(48px)",
                  }}
                />

                <div className="relative z-[2] h-[88%] w-full">
                  <Image
                    src={productImageSrc!}
                    alt="Product"
                    fill
                    priority
                    unoptimized={isBlob}
                    draggable={false}
                    className="object-contain select-none"
                    style={{
                      filter:
                        "drop-shadow(0 28px 42px rgba(0,0,0,0.42)) drop-shadow(0 8px 18px rgba(0,0,0,0.28))",
                    }}
                    sizes="(max-width: 720px) 58vw, 400px"
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                <ImagePlus
                  className="size-8 text-white/25"
                  strokeWidth={1.5}
                />
                <p className="text-[10px] leading-relaxed text-white/35">
                  Upload photo in sidebar
                  <br />
                  Drag frame to set position
                </p>
              </div>
            )}
          </div>

          {isProductSelected && (
            <>
              <HandleButton
                ariaLabel="Rotate"
                onPointerDown={onPointerDown("rotate")}
                className="-top-5 left-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing"
              >
                <RotateCw className="size-3" strokeWidth={2} />
              </HandleButton>
              <HandleButton
                ariaLabel="Resize corner"
                onPointerDown={onPointerDown("resize-se")}
                className="-bottom-1 -right-1 cursor-se-resize"
              />
              <HandleButton
                ariaLabel="Resize width"
                onPointerDown={onPointerDown("resize-e")}
                className="-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize"
              />
              <HandleButton
                ariaLabel="Resize height"
                onPointerDown={onPointerDown("resize-s")}
                className="-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize"
              />
            </>
          )}

          <div
            className={cn(
              "pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/[0.08] bg-black/40 px-2 py-0.5 text-[9px] text-white/40 backdrop-blur-sm transition-opacity",
              isProductSelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            )}
          >
            Drag · handles resize · top handle tilts
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function HandleButton({
  ariaLabel,
  onPointerDown,
  className,
  children,
}: {
  ariaLabel: string;
  onPointerDown: (e: React.PointerEvent) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute z-30 flex size-5 items-center justify-center rounded-full touch-none",
        "border border-white/35 bg-violet-500/80 shadow-lg",
        "text-white/90 transition-transform hover:scale-110 hover:bg-violet-400",
        className
      )}
    >
      {children}
    </button>
  );
}
