import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { goldOrnamentListQuerySchema } from "@/lib/validators-domain";
import { ornamentInclude, serializeOrnament } from "@/lib/gold-service";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[gold/ornaments]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * The flat ornament list behind /investments/gold — one row per physical
 * piece, regardless of which bill it came in on.
 *
 * Also reports how many legacy gold holdings have no acquisition yet, so
 * the page can say "N holdings aren't itemised" instead of silently
 * showing fewer pieces than the user owns during the backfill window.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWorkspace("investments", "read");
    const session = await auth();
    const url = new URL(request.url);
    const parsed = goldOrnamentListQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      scope: url.searchParams.get("scope") ?? undefined,
      contactId: url.searchParams.get("contactId") ?? undefined,
      acquisitionId: url.searchParams.get("acquisitionId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const q = parsed.data;

    // Ownership lives on the acquisition, so `own only` members filter
    // through the parent rather than on the ornament itself.
    const acquisitionScope = visibilityFilter(session, ctx.ownOnly);

    const [ornaments, othersRows, unItemisedCount] = await Promise.all([
      prisma.goldOrnament.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(q.status === "ALL" ? {} : { status: q.status }),
          // A piece bought for a contact is their asset, not a holding.
          ...(q.scope === "MINE"
            ? { boughtForContactId: null }
            : q.scope === "OTHERS"
              ? { boughtForContactId: { not: null } }
              : {}),
          ...(q.acquisitionId ? { acquisitionId: q.acquisitionId } : {}),
          ...(q.contactId
            ? {
                OR: [
                  { assignedContactId: q.contactId },
                  { boughtForContactId: q.contactId },
                  { disposalContactId: q.contactId },
                  { acquisition: { giftedByContactId: q.contactId } },
                ],
              }
            : {}),
          ...(Object.keys(acquisitionScope).length
            ? { acquisition: acquisitionScope }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { sortOrder: "asc" }],
        include: {
          ...ornamentInclude,
          acquisition: {
            select: {
              id: true,
              kind: true,
              sellerName: true,
              billNumber: true,
              acquiredAt: true,
              investmentId: true,
              giftedByContact: { select: { id: true, name: true } },
            },
          },
        },
      }),
      // Reported separately so the holdings list can drop these rows
      // without losing the "owed to you" figure they drive.
      prisma.goldOrnament.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          boughtForContactId: { not: null },
          ...(Object.keys(acquisitionScope).length
            ? { acquisition: acquisitionScope }
            : {}),
        },
        select: {
          id: true,
          memberCharges: { select: { amount: true, settledAmount: true, status: true } },
        },
      }),
      prisma.investment.count({
        where: {
          workspaceId: ctx.workspaceId,
          kind: "GOLD",
          goldAcquisition: null,
        },
      }),
    ]);

    return NextResponse.json({
      ornaments: ornaments.map((o) => ({
        ...serializeOrnament(o),
        acquisition: {
          id: o.acquisition.id,
          kind: o.acquisition.kind,
          sellerName: o.acquisition.sellerName,
          billNumber: o.acquisition.billNumber,
          acquiredAt: o.acquisition.acquiredAt.toISOString(),
          investmentId: o.acquisition.investmentId,
          giftedByContact: o.acquisition.giftedByContact,
        },
      })),
      unItemisedCount,
      othersCount: othersRows.length,
      owedToYou: Math.round(
        othersRows.reduce(
          (a, o) =>
            a +
            o.memberCharges.reduce(
              (b, c) =>
                c.status === "WRITTEN_OFF"
                  ? b
                  : b + Number(c.amount) - Number(c.settledAmount),
              0,
            ),
          0,
        ) * 100,
      ) / 100,
    });
  } catch (e) {
    return err(e);
  }
}
