import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace, WorkspaceAccessError } from "@/lib/workspace";

function err(e: unknown) {
  if (e instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[vehicles/[id]/fuel-summary]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Fuel & mileage summary for a single vehicle.
 *
 * Returns:
 *   - vehicle.{id, name, fuelType, odometerStart}
 *   - totals: spent, quantity, fills
 *   - km driven (latest odometer reading − earliest, falling back to
 *     odometerStart when only one reading exists)
 *   - mileage (km / quantity-unit) — only when ≥ 2 odometer readings
 *     exist so we have a real distance traveled. The traditional
 *     fill-to-fill formula (distance between fills ÷ fuel filled at
 *     the SECOND fill) is used; this represents what was actually
 *     consumed to cover that distance.
 *   - last 30 fills (date, qty, unit, odometer, amount, perUnitMileage)
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireWorkspace("vehicles", "read");
    const { id } = await context.params;
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fuelType: true,
        odometerStart: true,
        workspaceId: true,
      },
    });
    if (!vehicle || vehicle.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Pull every fuel-fill transaction (vehicle-tagged + has a fuel
    // quantity recorded). Sorted by date asc so the fill-to-fill
    // formula reads as a forward sequence.
    const fills = await prisma.transaction.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        vehicleId: id,
        type: "EXPENSE",
        // Only treat rows with explicit fuelQuantity as real fills —
        // tax / toll / wash etc. tagged to the same vehicle aren't fuel.
        fuelQuantity: { not: null },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        fuelQuantity: true,
        fuelUnit: true,
        fuelOdometer: true,
      },
    });

    let totalSpent = 0;
    let totalQty = 0;
    const fillRows: {
      id: string;
      date: string;
      amount: number;
      description: string;
      quantity: number;
      unit: string | null;
      odometer: number | null;
      kmSincePrev: number | null;
      mileage: number | null; // km per unit, between this fill and the previous
    }[] = [];
    let prevOdo: number | null = null;
    for (const f of fills) {
      const qty = Number(f.fuelQuantity ?? 0);
      const amt = Number(f.amount);
      totalSpent += amt;
      totalQty += qty;
      const odo = f.fuelOdometer;
      const kmSincePrev =
        odo != null && prevOdo != null && odo > prevOdo ? odo - prevOdo : null;
      const mileage =
        kmSincePrev != null && qty > 0 ? kmSincePrev / qty : null;
      fillRows.push({
        id: f.id,
        date: f.date.toISOString(),
        amount: amt,
        description: f.description,
        quantity: qty,
        unit: f.fuelUnit,
        odometer: odo,
        kmSincePrev,
        mileage,
      });
      if (odo != null) prevOdo = odo;
    }

    // Total km driven — prefer (latest odometer − earliest odometer)
    // among the fills themselves. Fall back to (latest − vehicle's
    // odometerStart) when only one fill has been recorded.
    const odoReadings = fillRows
      .map((r) => r.odometer)
      .filter((o): o is number => o != null);
    const earliestOdo = odoReadings[0] ?? null;
    const latestOdo = odoReadings[odoReadings.length - 1] ?? null;
    let totalKm: number | null = null;
    if (earliestOdo != null && latestOdo != null && latestOdo >= earliestOdo) {
      totalKm = latestOdo - earliestOdo;
    } else if (
      latestOdo != null &&
      vehicle.odometerStart != null &&
      latestOdo >= vehicle.odometerStart
    ) {
      totalKm = latestOdo - vehicle.odometerStart;
    }

    // Average mileage = total km between first and last fill (with
    // odometers known) divided by total fuel consumed *between* those
    // two fills (excluding the first fill itself, which was unrelated
    // distance). This matches the fill-to-fill convention.
    let averageMileage: number | null = null;
    if (
      earliestOdo != null &&
      latestOdo != null &&
      latestOdo > earliestOdo &&
      odoReadings.length >= 2
    ) {
      const km = latestOdo - earliestOdo;
      let qtyBetween = 0;
      let foundFirst = false;
      for (const r of fillRows) {
        if (r.odometer == null) continue;
        if (!foundFirst) {
          foundFirst = true; // skip the FIRST fill's fuel — it didn't drive `km`
          continue;
        }
        qtyBetween += r.quantity;
      }
      if (qtyBetween > 0) averageMileage = km / qtyBetween;
    }

    return NextResponse.json({
      vehicle: {
        id: vehicle.id,
        name: vehicle.name,
        fuelType: vehicle.fuelType,
        odometerStart: vehicle.odometerStart,
      },
      totals: {
        spent: totalSpent,
        quantity: totalQty,
        fills: fillRows.length,
        unit: fillRows[fillRows.length - 1]?.unit ?? null,
      },
      kmDriven: totalKm,
      averageMileage,
      // Most recent first for display.
      fills: fillRows.slice(-30).reverse(),
    });
  } catch (e) {
    return err(e);
  }
}
