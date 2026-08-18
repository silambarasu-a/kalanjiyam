import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";
import { visibilityFilter } from "@/lib/permissions";
import { goldRevalueSchema } from "@/lib/validators-domain";
import { round2, valueOrnamentAtRate, type GoldStoneInput } from "@/lib/gold";
import type { Prisma } from "@/generated/prisma/client";

export const maxDuration = 30;

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[gold/revalue]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Mark every gold holding to a manually-entered 24K rate.
 *
 * There is no live gold feed in this app (/api/market/quote is Yahoo
 * equities), so the rate comes from the user. The result is written into
 * Investment.currentValue — the field the dashboard, the reports table
 * and the investments list already read — so nothing downstream needs to
 * learn about ornaments.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspace("investments", "write");
    const session = await auth();
    const body = await request.json();
    const parsed = goldRevalueSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const { ratePerGram24K, includeStonesAtCost, valuedAt } = parsed.data;
    const stamp = valuedAt ? new Date(valuedAt) : new Date();

    const acquisitions = await prisma.goldAcquisition.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        investmentId: { not: null },
        ...visibilityFilter(session, ctx.ownOnly),
      },
      select: {
        investmentId: true,
        investment: { select: { metadata: true } },
        ornaments: {
          // Only pieces the workspace still holds and actually owns.
          where: { status: "HELD", boughtForContactId: null },
          select: {
            netWeightGrams: true,
            purity: true,
            stones: true,
          },
        },
      },
    });

    let updated = 0;
    for (const acq of acquisitions) {
      if (!acq.investmentId) continue;
      const currentValue = round2(
        acq.ornaments.reduce(
          (a, o) =>
            a +
            valueOrnamentAtRate(
              {
                netWeightGrams: Number(o.netWeightGrams),
                purity: o.purity,
                stones: (o.stones as GoldStoneInput[] | null) ?? null,
              },
              ratePerGram24K,
              includeStonesAtCost,
            ),
          0,
        ),
      );

      const existingMeta =
        acq.investment?.metadata &&
        typeof acq.investment.metadata === "object" &&
        !Array.isArray(acq.investment.metadata)
          ? (acq.investment.metadata as Record<string, unknown>)
          : {};

      await prisma.investment.update({
        where: { id: acq.investmentId },
        data: {
          currentValue,
          metadata: {
            ...existingMeta,
            valuation: {
              ratePerGram24K,
              includeStonesAtCost,
              valuedAt: stamp.toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });
      updated++;
    }

    return NextResponse.json({
      updated,
      ratePerGram24K,
      valuedAt: stamp.toISOString(),
    });
  } catch (e) {
    return err(e);
  }
}
