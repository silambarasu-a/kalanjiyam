import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { MemberChargeStatus } from "@/generated/prisma/client";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[charge-forgive]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

// Flip a charge to WRITTEN_OFF, preserving any settlements already recorded
// against it. Used when the user decides not to collect the outstanding
// balance from a contact — gives a clean exit that keeps the audit trail
// intact instead of deleting the charge.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("members", "write");
    const { id } = await context.params;
    const charge = await prisma.memberCharge.findUnique({ where: { id } });
    if (!charge || charge.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (charge.status === MemberChargeStatus.WRITTEN_OFF) {
      return NextResponse.json({ ok: true, alreadyForgiven: true });
    }
    if (charge.status === MemberChargeStatus.SETTLED) {
      return NextResponse.json(
        { error: "Already fully settled — nothing to forgive" },
        { status: 400 },
      );
    }
    await prisma.memberCharge.update({
      where: { id },
      data: { status: MemberChargeStatus.WRITTEN_OFF },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
