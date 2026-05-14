import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireWorkspace,
  WorkspaceAccessError,
  assertWorkspaceContact,
} from "@/lib/workspace";
import { vehicleUpdateSchema } from "@/lib/validators-domain";
import { VehicleKind, VehicleFuelType } from "@/generated/prisma/client";
import { archiveAttachmentsForOwners } from "@/lib/attachment-archive";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vehicles/:id]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "read");
    const { id } = await context.params;
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        ownerContact: { select: { id: true, name: true } },
        disposalContact: { select: { id: true, name: true } },
        replacedBy: { select: { id: true, name: true, registrationNo: true } },
        replaces: { select: { id: true, name: true, registrationNo: true } },
        insurances: {
          select: {
            id: true,
            name: true,
            institution: true,
            policyNumber: true,
            insuranceStatus: true,
            premiumAmount: true,
            premiumFrequency: true,
            nextDueDate: true,
          },
        },
        loans: {
          select: {
            id: true,
            kind: true,
            lender: true,
            principal: true,
            outstanding: true,
            nextDueDate: true,
            active: true,
          },
        },
        claims: {
          select: {
            id: true,
            claimNumber: true,
            status: true,
            incidentDate: true,
            claimedAmount: true,
            receivedAmount: true,
          },
          orderBy: { incidentDate: "desc" },
        },
        transactions: {
          take: 100,
          orderBy: { date: "desc" },
          select: {
            id: true,
            type: true,
            amount: true,
            date: true,
            description: true,
            categoryId: true,
            category: {
              select: {
                id: true,
                name: true,
                parent: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!vehicle || vehicle.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      vehicle: {
        id: vehicle.id,
        kind: vehicle.kind,
        name: vehicle.name,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        registrationNo: vehicle.registrationNo,
        fuelType: vehicle.fuelType,
        purchaseDate: vehicle.purchaseDate?.toISOString() ?? null,
        purchasePrice:
          vehicle.purchasePrice == null ? null : Number(vehicle.purchasePrice),
        odometerStart: vehicle.odometerStart,
        active: vehicle.active,
        notes: vehicle.notes,
        ownerContact: vehicle.ownerContact,
        disposedAt: vehicle.disposedAt?.toISOString() ?? null,
        disposalKind: vehicle.disposalKind,
        disposalAmount:
          vehicle.disposalAmount == null ? null : Number(vehicle.disposalAmount),
        disposalContact: vehicle.disposalContact,
        replacedBy: vehicle.replacedBy,
        replaces: vehicle.replaces,
        insurances: vehicle.insurances.map((i) => ({
          ...i,
          premiumAmount: i.premiumAmount == null ? null : Number(i.premiumAmount),
          nextDueDate: i.nextDueDate?.toISOString() ?? null,
        })),
        loans: vehicle.loans.map((l) => ({
          ...l,
          principal: Number(l.principal),
          outstanding: Number(l.outstanding),
          nextDueDate: l.nextDueDate?.toISOString() ?? null,
        })),
        claims: vehicle.claims.map((c) => ({
          ...c,
          incidentDate: c.incidentDate.toISOString(),
          claimedAmount: c.claimedAmount == null ? null : Number(c.claimedAmount),
          receivedAmount: c.receivedAmount == null ? null : Number(c.receivedAmount),
        })),
        transactions: vehicle.transactions.map((t) => ({
          ...t,
          amount: Number(t.amount),
          date: t.date.toISOString(),
        })),
      },
    });
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const { id } = await context.params;
    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = vehicleUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const data = parsed.data;
    if (data.ownerContactId) {
      await assertWorkspaceContact(ctx.workspaceId, data.ownerContactId);
    }
    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        // Prisma 7's update types no longer accept the scalar FK
        // directly for required relations — route through the
        // relation field. Only included when the client actually sent
        // a (possibly unchanged) ownerContactId so we don't fire an
        // unnecessary connect on every edit.
        ...(data.ownerContactId
          ? {
              ownerContact: {
                connect: { id: data.ownerContactId },
              },
            }
          : {}),
        kind: (data.kind as VehicleKind | undefined) ?? existing.kind,
        name: data.name ?? existing.name,
        make: data.make ?? existing.make,
        model: data.model ?? existing.model,
        year: data.year ?? existing.year,
        registrationNo:
          data.registrationNo !== undefined
            ? data.registrationNo?.trim() || null
            : existing.registrationNo,
        fuelType:
          data.fuelType === undefined
            ? existing.fuelType
            : (data.fuelType as VehicleFuelType | null),
        purchaseDate:
          data.purchaseDate !== undefined
            ? data.purchaseDate
              ? new Date(data.purchaseDate)
              : null
            : existing.purchaseDate,
        purchasePrice: data.purchasePrice ?? existing.purchasePrice,
        odometerStart: data.odometerStart ?? existing.odometerStart,
        notes: data.notes ?? existing.notes,
        active: data.active ?? existing.active,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "write");
    const { id } = await context.params;
    const existing = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        _count: { select: { transactions: true, insurances: true, loans: true } },
      },
    });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Don't delete if anything is still linked. Vehicle FKs are
    // ON DELETE SET NULL so this is conservative — change to a 409 with
    // a message instead of orphaning history rows. User can deactivate.
    if (
      existing._count.transactions > 0 ||
      existing._count.insurances > 0 ||
      existing._count.loans > 0
    ) {
      return NextResponse.json(
        {
          error:
            "This vehicle has linked transactions, policies, or loans. Deactivate it instead.",
        },
        { status: 409 },
      );
    }
    // Find every VehicleDocument that will cascade-delete with the
    // vehicle so we can archive their Attachments first (the
    // polymorphic FK doesn't cascade automatically).
    const docs = await prisma.vehicleDocument.findMany({
      where: { vehicleId: id },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      if (docs.length > 0) {
        await archiveAttachmentsForOwners({
          workspaceId: ctx.workspaceId,
          ownerKind: "VEHICLE_DOCUMENT",
          ownerIds: docs.map((d) => d.id),
          userId: ctx.userId,
          tx,
        });
      }
      await tx.vehicle.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
