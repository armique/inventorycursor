import { NextResponse } from "next/server";

import { processImageBuffer } from "@/lib/image-processing.server";
import { DEFAULT_UPLOAD_CONSTRAINTS } from "@/lib/upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > DEFAULT_UPLOAD_CONSTRAINTS.maxSizeBytes) {
      return NextResponse.json({ error: "File too large" }, { status: 400 });
    }

    const removeBackground = form.get("removeBackground") !== "false";
    const buffer = Buffer.from(await file.arrayBuffer());
    const processed = await processImageBuffer(buffer, { removeBackground });

    return new NextResponse(new Uint8Array(processed), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("process-product-image:", error);
    return NextResponse.json(
      { error: "Image processing failed" },
      { status: 500 }
    );
  }
}
