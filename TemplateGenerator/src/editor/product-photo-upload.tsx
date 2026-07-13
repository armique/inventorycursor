"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";

import { usePreviewStore } from "@/hooks/use-preview-store";
import { hasProductImage } from "@/lib/product-image";
import { DEFAULT_UPLOAD_CONSTRAINTS } from "@/lib/upload";
import { cn } from "@/lib/utils";

export function ProductPhotoUpload() {
  const productImageSrc = usePreviewStore((s) => s.productImageSrc);
  const autoRemoveBackground = usePreviewStore((s) => s.autoRemoveBackground);
  const isProcessingImage = usePreviewStore((s) => s.isProcessingImage);
  const imageProcessingStep = usePreviewStore((s) => s.imageProcessingStep);
  const imageProcessingError = usePreviewStore((s) => s.imageProcessingError);
  const setProductImage = usePreviewStore((s) => s.setProductImage);
  const setAutoRemoveBackground = usePreviewStore((s) => s.setAutoRemoveBackground);
  const uploadProductImage = usePreviewStore((s) => s.uploadProductImage);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file || isProcessingImage) return;
      await uploadProductImage(file);
    },
    [uploadProductImage, isProcessingImage]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize: DEFAULT_UPLOAD_CONSTRAINTS.maxSizeBytes,
    accept: DEFAULT_UPLOAD_CONSTRAINTS.accept,
    disabled: isProcessingImage,
  });

  const hasImage = hasProductImage(productImageSrc);
  const isBlob = productImageSrc?.startsWith("blob:") ?? false;

  const removeImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setProductImage(null);
  };

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={cn(
          "group relative flex h-36 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden",
          "rounded-2xl border border-dashed transition-colors",
          isProcessingImage && "pointer-events-none opacity-80",
          isDragActive
            ? "border-violet-400/50 bg-violet-500/[0.08]"
            : "border-white/[0.12] bg-white/[0.02] hover:border-violet-400/30 hover:bg-violet-500/[0.04]"
        )}
      >
        <input {...getInputProps()} />

        {isProcessingImage ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <Loader2 className="size-6 animate-spin text-violet-400" />
            <p className="text-xs font-medium text-foreground/90">
              Processing image…
            </p>
            <p className="text-[10px] text-muted-foreground">
              {imageProcessingStep ?? "Please wait"}
            </p>
          </div>
        ) : hasImage ? (
          <>
            <Image
              src={productImageSrc!}
              alt="Product preview"
              fill
              unoptimized={isBlob}
              className="object-contain p-3 opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <p className="relative z-10 text-[10px] font-medium text-white/80">
              Click or drop to replace
            </p>
            <button
              type="button"
              onClick={removeImage}
              className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-md border border-white/15 bg-black/50 text-white/70 transition-colors hover:bg-black/70 hover:text-white"
              title="Remove photo"
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <div className="flex size-10 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-white/[0.08] transition-transform group-hover:scale-105">
              <ImagePlus
                className="size-4 text-muted-foreground"
                strokeWidth={1.75}
              />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-foreground/90">
                Drop product image
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Auto cutout · PNG export · max 10 MB
              </p>
            </div>
          </>
        )}
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
        <input
          type="checkbox"
          checked={autoRemoveBackground}
          onChange={(e) => setAutoRemoveBackground(e.target.checked)}
          className="size-3.5 rounded border-white/20 accent-violet-500"
        />
        <Sparkles className="size-3 text-violet-400/80" />
        <span className="text-[10px] text-muted-foreground">
          Auto-remove background, crop & enhance
        </span>
      </label>

      {imageProcessingError && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.08] px-2.5 py-2 text-[10px] leading-relaxed text-amber-200/90">
          {imageProcessingError}
        </p>
      )}
    </div>
  );
}
