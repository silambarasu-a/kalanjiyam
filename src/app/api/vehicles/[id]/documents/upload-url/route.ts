import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { vehicleDocumentUploadUrlSchema } from "@/lib/validators-domain";
import {
  buildVehicleDocKey,
  isS3Configured,
  presignPut,
  S3ConfigError,
} from "@/lib/s3";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof S3ConfigError) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  console.error("[vehicles/documents/upload-url]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: "File uploads are not configured on this server" },
        { status: 503 },
      );
    }
    const ctx = await requireWorkspace("vehicles", "write");
    const { id } = await context.params;
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle || vehicle.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = vehicleDocumentUploadUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const { filename, contentType, size } = parsed.data;
    const key = buildVehicleDocKey({
      workspaceId: ctx.workspaceId,
      vehicleId: id,
      filename,
    });
    const url = await presignPut(key, contentType, 600);
    return NextResponse.json({
      url,
      key,
      filename,
      contentType,
      size,
      expiresInSeconds: 600,
    });
  } catch (e) {
    return err(e);
  }
}
