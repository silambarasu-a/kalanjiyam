import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { vehicleCreateSchema } from "@/lib/validators-domain";
import { VehicleKind } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vehicles]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await requireWorkspace("vehicles", "read");
    const vehicles = await prisma.vehicle.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      include: {
        ownerContact: { select: { id: true, name: true } },
        _count: {
          select: { insurances: true, loans: true, claims: true, transactions: true },
        },
      },
    });
    return NextResponse.json({
      vehicles: vehicles.map((v) => ({
        id: v.id,
        kind: v.kind,
        name: v.name,
        make: v.make,
        model: v.model,
        year: v.year,
        registrationNo: v.registrationNo,
        purchaseDate: v.purchaseDate?.toISOString() ?? null,
        purchasePrice: v.purchasePrice == null ? null : Number(v.purchasePrice),
        odometerStart: v.odometerStart,
        active: v.active,
        notes: v.notes,
        ownerContact: v.ownerContact,
        counts: v._count,
      })),
    });
  } catch (e) {
    return err(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const body = await request.json();
    const parsed = vehicleCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    await assertWorkspaceContact(ctx.workspaceId, data.ownerContactId);
    const vehicle = await prisma.vehicle.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerContactId: data.ownerContactId,
        kind: data.kind as VehicleKind,
        name: data.name,
        make: data.make,
        model: data.model,
        year: data.year ?? null,
        registrationNo: data.registrationNo?.trim() || null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchasePrice: data.purchasePrice ?? null,
        odometerStart: data.odometerStart ?? null,
        notes: data.notes,
      },
    });
    return NextResponse.json({ id: vehicle.id });
  } catch (e) {
    return err(e);
  }
}
