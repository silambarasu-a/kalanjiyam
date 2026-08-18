import type { Prisma } from "@/generated/prisma/client";
import { round2, round3 } from "@/lib/gold";

/**
 * Keeps the Investment row in sync with the ornaments that back it.
 *
 * `Investment.amount` and `Investment.quantity` are what the dashboard,
 * the reports table and the investments list all sum, so they have to
 * stay true after every ornament mutation. Two filters do all the work:
 *
 *   - `boughtForContactId == null` — a piece bought on someone's behalf
 *     is THEIR asset. Its money lives in the MemberCharge receivable, not
 *     in this holding, and its grams are not the workspace's grams.
 *   - `status == HELD` — sold and gifted-away pieces drop out, so the
 *     holding falls by exactly that piece's cost basis and weight. No
 *     running subtraction, no clamping, no drift.
 *
 * Cost basis is set at write time (lineTotal for an own purchase, 0 for
 * gifts received, user-entered for opening stock), which is what makes a
 * gifted piece contribute real grams and ₹0 to "Invested".
 *
 * Call this at the END of every gold mutation's $transaction, after the
 * ornament rows are final.
 */
export async function recomputeGoldInvestment(
  tx: Prisma.TransactionClient,
  acquisitionId: string,
): Promise<void> {
  const acquisition = await tx.goldAcquisition.findUnique({
    where: { id: acquisitionId },
    select: { investmentId: true },
  });
  // An on-behalf-only acquisition has no holding to roll up into.
  if (!acquisition?.investmentId) return;

  const ornaments = await tx.goldOrnament.findMany({
    where: {
      acquisitionId,
      boughtForContactId: null,
      status: "HELD",
    },
    select: { costBasis: true, netWeightGrams: true },
  });

  const amount = round2(
    ornaments.reduce((a, o) => a + Number(o.costBasis), 0),
  );
  const quantity = round3(
    ornaments.reduce((a, o) => a + Number(o.netWeightGrams), 0),
  );

  await tx.investment.update({
    where: { id: acquisition.investmentId },
    data: {
      amount,
      quantity,
      // Blended ₹/gram across the pieces still held. Null rather than 0
      // when there's nothing left or nothing was paid, so the UI shows
      // "—" instead of a misleading zero rate.
      purchasePrice:
        amount > 0 && quantity > 0 ? round2(amount / quantity) : null,
      // A holding with every piece sold or gifted away is closed, not a
      // ₹0 open position.
      active: ornaments.length > 0,
      // currentValue is deliberately untouched — it belongs to the
      // revalue route, which is the only thing that knows a gold rate.
    },
  });
}
