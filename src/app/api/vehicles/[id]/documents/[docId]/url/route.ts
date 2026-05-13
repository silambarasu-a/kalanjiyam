import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { isS3Configured, presignGet, S3ConfigError } from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof S3ConfigError) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  console.error("[vehicles/documents/[docId]/url]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: "File storage is not configured" },
        { status: 503 },
      );
    }
    const ctx = await requireWorkspace("vehicles", "read");
    const { id, docId } = await context.params;
    const doc = await prisma.vehicleDocument.findUnique({
      where: { id: docId },
    });
    if (
      !doc ||
      doc.workspaceId !== ctx.workspaceId ||
      doc.vehicleId !== id ||
      !doc.attachmentKey
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const url = await presignGet(doc.attachmentKey, 300);
    return NextResponse.json({
      url,
      filename: doc.attachmentFilename,
      mimeType: doc.attachmentMimeType,
      size: doc.attachmentSize,
      expiresInSeconds: 300,
    });
  } catch (e) {
    return err(e);
  }
}
