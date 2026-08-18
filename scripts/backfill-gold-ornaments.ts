/**
 * Backfill GoldAcquisition + GoldOrnament rows for legacy gold holdings.
 *
 * Before ornaments existed, one Investment(kind: GOLD) WAS one ornament,
 * with its whole breakdown in an untyped `metadata` blob. This turns each
 * of those into the new shape: a PURCHASE acquisition holding exactly one
 * ornament, so the bill/ornament UI can see it and the rollup keeps
 * working.
 *
 * MONEY-SAFETY RULE: lineTotal and costBasis are copied from
 * Investment.amount — ground truth, what was actually paid — and NOT
 * recomputed from the metadata components. computeOrnamentLine() runs
 * only as a CHECK; a disagreement is logged for the user to correct in
 * the UI, never silently applied. That makes this script arithmetically
 * incapable of moving money.
 *
 * Idempotent with no marker column: it selects only gold holdings that
 * have no acquisition yet, and the relation is 1:1, so a second run is a
 * strict no-op.
 *
 * Run with: npx tsx scripts/backfill-gold-ornaments.ts [--dry-run]
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeOrnamentLine, round3 } from "../src/lib/gold";

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes("--dry-run");

type LegacyMeta = {
  goldType?: string;
  purity?: string;
  grossWeight?: number | null;
  stones?: Array<{
    kind?: string | null;
    weight?: number;
    carats?: number;
    ratePerCt?: number;
    charge?: number;
  }> | null;
  wastage?: number | null;
  wastageInput?: string | null;
  wastageMode?: string | null;
  making?: number | null;
  makingInput?: string | null;
  makingMode?: string | null;
  cgst?: number | null;
  cgstInput?: string | null;
  cgstMode?: string | null;
  sgst?: number | null;
  sgstInput?: string | null;
  sgstMode?: string | null;
  roundOff?: number | null;
};

const PURITIES = new Set(["24K", "22K", "18K", "14K", "OTHER"]);

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const legacy = await prisma.investment.findMany({
    where: { kind: "GOLD", goldAcquisition: null },
    select: {
      id: true,
      workspaceId: true,
      ownerUserId: true,
      sharedWithUserIds: true,
      name: true,
      institution: true,
      amount: true,
      quantity: true,
      purchasePrice: true,
      startedAt: true,
      notes: true,
      metadata: true,
    },
  });

  console.log(
    `${legacy.length} gold holding(s) to itemise${DRY_RUN ? " (dry run)" : ""}.`,
  );

  let created = 0;
  let stamped = 0;
  const mismatches: string[] = [];

  for (const inv of legacy) {
    const md: LegacyMeta =
      inv.metadata && typeof inv.metadata === "object" && !Array.isArray(inv.metadata)
        ? (inv.metadata as LegacyMeta)
        : {};

    const stones = Array.isArray(md.stones)
      ? md.stones
          .map((s) => ({
            kind: s.kind ?? null,
            weight: num(s.weight),
            carats: s.carats == null ? null : num(s.carats),
            ratePerCt: s.ratePerCt == null ? null : num(s.ratePerCt),
            charge: num(s.charge),
          }))
          .filter((s) => s.weight > 0 || s.charge > 0)
      : [];

    const stoneWeight = round3(stones.reduce((a, s) => a + s.weight, 0));
    // `quantity` was already the NET weight, so gross is net + stones
    // unless the metadata recorded a gross of its own.
    const netWeight = round3(num(inv.quantity));
    const grossWeight =
      md.grossWeight != null && num(md.grossWeight) > 0
        ? round3(num(md.grossWeight))
        : round3(netWeight + stoneWeight);
    const ratePerGram = num(inv.purchasePrice);
    const amount = Number(inv.amount);

    // CHECK ONLY — never applied. Flags rows whose stored components
    // drifted from what they add up to, so the user can fix them.
    const check = computeOrnamentLine({
      grossWeightGrams: grossWeight,
      ratePerGram,
      stones,
      wastageInput: md.wastageInput ?? md.wastage ?? null,
      wastageMode: (md.wastageMode as "PERCENT" | "RUPEE") ?? "RUPEE",
      makingInput: md.makingInput ?? md.making ?? null,
      makingMode: (md.makingMode as "PERCENT" | "RUPEE") ?? "RUPEE",
      cgstInput: md.cgstInput ?? md.cgst ?? null,
      cgstMode: (md.cgstMode as "PERCENT" | "RUPEE") ?? "RUPEE",
      sgstInput: md.sgstInput ?? md.sgst ?? null,
      sgstMode: (md.sgstMode as "PERCENT" | "RUPEE") ?? "RUPEE",
      roundOff: num(md.roundOff),
    });
    if (Math.abs(check.lineTotal - amount) > 1) {
      mismatches.push(
        `  ${inv.id} "${inv.name}": stored ₹${amount.toFixed(2)}, ` +
          `components add to ₹${check.lineTotal.toFixed(2)}`,
      );
    }

    const purity =
      md.purity && PURITIES.has(md.purity.toUpperCase())
        ? md.purity.toUpperCase()
        : null;

    if (!DRY_RUN) {
      await prisma.$transaction(async (tx) => {
        const acq = await tx.goldAcquisition.create({
          data: {
            workspaceId: inv.workspaceId,
            kind: "PURCHASE",
            investmentId: inv.id,
            ownerUserId: inv.ownerUserId,
            sharedWithUserIds: inv.sharedWithUserIds,
            sellerName: inv.institution,
            acquiredAt: inv.startedAt,
            billTotal: inv.amount,
            notes: inv.notes,
          },
        });
        await tx.goldOrnament.create({
          data: {
            workspaceId: inv.workspaceId,
            acquisitionId: acq.id,
            name: inv.name,
            itemType: md.goldType ?? null,
            quantity: 1,
            purity,
            grossWeightGrams: grossWeight,
            stoneWeightGrams: stoneWeight,
            netWeightGrams: netWeight,
            ratePerGram,
            wastageAmount: num(md.wastage),
            wastageInput: md.wastageInput ?? null,
            wastageMode: md.wastageMode ?? "RUPEE",
            makingAmount: num(md.making),
            makingInput: md.makingInput ?? null,
            makingMode: md.makingMode ?? "RUPEE",
            stones: stones.length ? stones : undefined,
            cgstAmount: num(md.cgst),
            cgstInput: md.cgstInput ?? null,
            cgstMode: md.cgstMode ?? "RUPEE",
            sgstAmount: num(md.sgst),
            sgstInput: md.sgstInput ?? null,
            sgstMode: md.sgstMode ?? "RUPEE",
            roundOff: num(md.roundOff),
            // Ground truth: what the holding says was paid.
            lineTotal: amount,
            costBasis: amount,
            status: "HELD",
            sortOrder: 0,
          },
        });
      });
    }
    created++;

    // Legacy ornament BUYs couldn't be stamped — the investment validator
    // only ever allowed COIN/BAR/BISCUIT. Separate idempotent pass.
    if ((md.goldType ?? "").toUpperCase() === "ORNAMENTS" && !DRY_RUN) {
      const r = await prisma.transaction.updateMany({
        where: {
          investmentId: inv.id,
          investmentAction: "BUY",
          goldForm: null,
        },
        data: { goldForm: "ORNAMENT" },
      });
      stamped += r.count;
    }
  }

  console.log(`created: ${created}`);
  console.log(`goldForm stamped on ${stamped} legacy BUY transaction(s)`);
  if (mismatches.length) {
    console.warn(
      `\n${mismatches.length} holding(s) whose stored breakdown doesn't add up to the ` +
        `amount paid. Nothing was changed — the amount paid was kept. Review in the UI:`,
    );
    for (const m of mismatches) console.warn(m);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
