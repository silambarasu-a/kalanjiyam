import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { ReminderKind, ReminderStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("reminders", "read");
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") ?? "UPCOMING") as ReminderStatus;
    const kind = url.searchParams.get("kind") as ReminderKind | null;
    const days = Number(url.searchParams.get("days") ?? "365");

    const until = new Date();
    until.setDate(until.getDate() + days);

    const reminders = await prisma.investmentReminder.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status,
        ...(kind ? { kind } : {}),
        dueDate: { lte: until },
      },
      orderBy: { dueDate: "asc" },
      take: 100,
      include: {
        investment: { select: { id: true, name: true, kind: true, premiumAmount: true } },
        vehicleDocument: {
          select: {
            id: true,
            kind: true,
            label: true,
            vehicleId: true,
            vehicle: { select: { id: true, name: true, registrationNo: true } },
          },
        },
        subscription: { select: { id: true, name: true, cycle: true } },
        utilityBill: {
          select: {
            id: true,
            provider: {
              select: { id: true, providerName: true, kind: true },
            },
          },
        },
        utilityProvider: {
          select: { id: true, providerName: true, kind: true },
        },
      },
    });

    return NextResponse.json({
      reminders: reminders.map((r) => ({
        id: r.id,
        kind: r.kind,
        dueDate: r.dueDate.toISOString(),
        amount: r.amount == null ? null : Number(r.amount),
        status: r.status,
        investment: r.investment
          ? {
              id: r.investment.id,
              name: r.investment.name,
              kind: r.investment.kind,
              premiumAmount:
                r.investment.premiumAmount == null ? null : Number(r.investment.premiumAmount),
            }
          : null,
        vehicleDocument: r.vehicleDocument
          ? {
              id: r.vehicleDocument.id,
              kind: r.vehicleDocument.kind,
              label: r.vehicleDocument.label,
              vehicleId: r.vehicleDocument.vehicleId,
              vehicleName: r.vehicleDocument.vehicle?.name ?? null,
              registrationNo: r.vehicleDocument.vehicle?.registrationNo ?? null,
            }
          : null,
        subscription: r.subscription
          ? {
              id: r.subscription.id,
              name: r.subscription.name,
              cycle: r.subscription.cycle,
            }
          : null,
        utilityBill: r.utilityBill
          ? {
              id: r.utilityBill.id,
              providerId: r.utilityBill.provider.id,
              providerName: r.utilityBill.provider.providerName,
              providerKind: r.utilityBill.provider.kind,
            }
          : null,
        utilityProvider: r.utilityProvider
          ? {
              id: r.utilityProvider.id,
              providerName: r.utilityProvider.providerName,
              providerKind: r.utilityProvider.kind,
            }
          : null,
      })),
    });
  } catch (e) {
    return err(e);
  }
}
