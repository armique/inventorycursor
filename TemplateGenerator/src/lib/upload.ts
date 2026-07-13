/**
 * Asset upload pipeline — react-dropzone + auto background removal.
 */
export type AcceptedFileTypes = "image/*" | "image/png" | "image/jpeg" | "image/webp";

export type ImageProcessingStep =
  | "uploading"
  | "removing-background"
  | "enhancing"
  | "cropping"
  | "saving";

export type UploadConstraints = {
  maxFiles: number;
  maxSizeBytes: number;
  accept: Record<string, string[]>;
};

export const DEFAULT_UPLOAD_CONSTRAINTS: UploadConstraints = {
  maxFiles: 10,
  maxSizeBytes: 10 * 1024 * 1024,
  accept: {
    "image/*": [".png", ".jpg", ".jpeg", ".webp", ".svg"],
  },
};
