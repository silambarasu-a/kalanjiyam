import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { canModifyRecord } from "@/lib/permissions";
import { transactionUpdateSchema } from "@/lib/validators-domain";
import { MemberChargeType, MemberChargeStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

async function loadOwnership(transactionId: string) {
  const t = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      account: { select: { ownerUserId: true, sharedWithUserIds: true } },
      card: { select: { ownerUserId: true, sharedWithUserIds: true } },
    },
  });
  if (!t) return null;
  return {
    transaction: t,
    ownership: {
      ownerUserId: t.account?.ownerUserId ?? t.card?.ownerUserId ?? t.userId,
      sharedWithUserIds:
        t.account?.sharedWithUserIds ?? t.card?.sharedWithUserIds ?? [],
    },
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("transactions", "write");
    const session = await auth();
    const { id } = await context.params;
    const loaded = await loadOwnership(id);
    if (!loaded || loaded.transaction.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loaded.ownership)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await request.json();
    const parsed = transactionUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const t = loaded.transaction;
    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        amount: parsed.data.amount ?? t.amount,
        description: parsed.data.description ?? t.description,
        date: parsed.data.date ? new Date(parsed.data.date) : t.date,
        categoryId: parsed.data.categoryId === undefined ? t.categoryId : parsed.data.categoryId,
        beneficiaryMemberId:
          parsed.data.beneficiaryMemberId === undefined
            ? t.beneficiaryMemberId
            : parsed.data.beneficiaryMemberId,
        memberChargeType:
          parsed.data.memberChargeType !== undefined
            ? (parsed.data.memberChargeType as MemberChargeType)
            : t.memberChargeType,
        editNote: parsed.data.editNote ?? null,
        editedAt: new Date(),
        editedByUserId: ctx.userId,
      },
    });
    return NextResponse.json({ id: updated.id });
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("transactions", "write");
    const session = await auth();
    const { id } = await context.params;
    const loaded = await loadOwnership(id);
    if (!loaded || loaded.transaction.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canModifyRecord(session, loaded.ownership)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (loaded.transaction.transferId) {
      return NextResponse.json(
        { error: "Delete the transfer instead, not its leg." },
        { status: 400 }
      );
    }
    await prisma.$transaction(async (tx) => {
      // If linked to a MemberCharge that has no settlements, drop it too.
      if (loaded.transaction.memberChargeId) {
        const settlements = await tx.memberChargeSettlement.count({
          where: { chargeId: loaded.transaction.memberChargeId },
        });
        if (settlements === 0) {
          await tx.memberCharge.delete({
            where: { id: loaded.transaction.memberChargeId },
          });
        } else {
          await tx.memberCharge.update({
            where: { id: loaded.transaction.memberChargeId },
            data: { status: MemberChargeStatus.WRITTEN_OFF },
          });
        }
      }
      await tx.transaction.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
