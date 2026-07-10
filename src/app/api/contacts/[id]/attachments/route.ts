import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[contacts/attachments]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * GET /api/contacts/[id]/attachments
 *
 * Every receipt / supporting document attached to a transaction that
 * involves this contact — the "Attachments" tab on a contact's page.
 *
 * "Involves this contact" means the transaction is:
 *   - split with them (covers recoverable charges + shared expenses), OR
 *   - one they paid on the owner's behalf (paidByContactId), OR
 *   - a legacy single-beneficiary expense tagged to them.
 *
 * Attachments are grouped under their transaction so the UI can show the
 * money context and deep-link into the transaction detail view. Metadata
 * only — download URLs are minted on demand via /api/attachments/[id]/url.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // Gate on BOTH the contact feature (to reach the contact) and the
    // transactions feature — the payload is TRANSACTION_RECEIPT metadata
    // (filenames, uploader), which is gated by "transactions" everywhere
    // else (attachment list / download / transaction detail). Gating only
    // on "members" would let a transactions-hidden member enumerate receipt
    // filenames they otherwise can't see.
    await requireWorkspace("members", "read");
    const ctx = await requireWorkspace("transactions", "read");
    const { id } = await context.params;

    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact || contact.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Gather the ids of every transaction linked to this contact.
    const [splitRows, directRows] = await Promise.all([
      prisma.transactionSplit.findMany({
        where: { workspaceId: ctx.workspaceId, contactId: id },
        select: { transactionId: true },
      }),
      prisma.transaction.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          OR: [{ paidByContactId: id }, { beneficiaryContactId: id }],
        },
        select: { id: true },
      }),
    ]);

    const txnIds = Array.from(
      new Set([
        ...splitRows.map((s) => s.transactionId),
        ...directRows.map((t) => t.id),
      ]),
    );

    if (txnIds.length === 0) {
      return NextResponse.json({ count: 0, transactions: [] });
    }

    // Only fetch transactions that actually have active receipts, plus the
    // receipts themselves, in two workspace-scoped queries.
    const attachments = await prisma.attachment.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ownerKind: "TRANSACTION_RECEIPT",
        ownerId: { in: txnIds },
        archivedAt: null,
      },
      orderBy: { uploadedAt: "desc" },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    if (attachments.length === 0) {
      return NextResponse.json({ count: 0, transactions: [] });
    }

    const ownerIds = Array.from(new Set(attachments.map((a) => a.ownerId)));
    const transactions = await prisma.transaction.findMany({
      where: { workspaceId: ctx.workspaceId, id: { in: ownerIds } },
      select: {
        id: true,
        type: true,
        amount: true,
        description: true,
        date: true,
      },
    });
    const txnById = new Map(transactions.map((t) => [t.id, t]));

    // Group attachments under their transaction, newest transaction first.
    const groups = transactions
      .map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        date: t.date.toISOString(),
        attachments: attachments
          .filter((a) => a.ownerId === t.id)
          .map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            uploadedAt: a.uploadedAt.toISOString(),
            uploadedBy: a.uploadedBy
              ? { id: a.uploadedBy.id, name: a.uploadedBy.name }
              : null,
          })),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    // Defensive: skip any attachment whose transaction fell out of scope
    // (shouldn't happen — both queries are workspace-scoped on the same ids).
    const orphanCount = attachments.filter(
      (a) => !txnById.has(a.ownerId),
    ).length;

    return NextResponse.json({
      count: attachments.length - orphanCount,
      transactions: groups,
    });
  } catch (e) {
    return err(e);
  }
}
