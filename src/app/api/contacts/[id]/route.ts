import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { familyUpdateSchema } from "@/lib/validators-domain";
import { archiveAttachmentsForOwner } from "@/lib/attachment-archive";

function error(err: unknown) {
  if (err instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("contacts", "write");
    const { id } = await context.params;
    const body = await request.json();
    const parsed = familyUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const member = await prisma.contact.update({
      where: { id },
      data: {
        name: parsed.data.name ?? existing.name,
        relationship: parsed.data.relationship ?? existing.relationship,
        dob: parsed.data.dob ? new Date(parsed.data.dob) : existing.dob,
        notes: parsed.data.notes ?? existing.notes,
        active: parsed.data.active ?? existing.active,
        userId: parsed.data.userId ?? existing.userId,
      },
    });
    return NextResponse.json({ id: member.id });
  } catch (err) {
    return error(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWorkspace("contacts", "write");
    const { id } = await context.params;
    const existing = await prisma.contact.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // GoldOrnament.boughtForContactId is Restrict — you can't delete a
    // contact who owns gold you're still owed for. Caught here so the
    // user gets the ornament names instead of an opaque 500 from P2003.
    const ownedGold = await prisma.goldOrnament.findMany({
      where: { workspaceId: ctx.workspaceId, boughtForContactId: id },
      select: { name: true },
      take: 5,
    });
    if (ownedGold.length > 0) {
      return NextResponse.json(
        {
          error:
            `${existing.name} owns gold you bought for them ` +
            `(${ownedGold.map((o) => o.name).join(", ")}). ` +
            `Settle or remove those ornaments before deleting the contact.`,
        },
        { status: 409 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "INCOME_PROOF",
        ownerId: id,
        userId: ctx.userId,
        tx,
      });
      // Contact-owned documents (ID proofs, agreements, photos) are
      // archived alongside the contact so they don't dangle in S3.
      await archiveAttachmentsForOwner({
        workspaceId: ctx.workspaceId,
        ownerKind: "CONTACT_DOCUMENT",
        ownerId: id,
        userId: ctx.userId,
        tx,
      });
      await tx.contact.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return error(err);
  }
}
