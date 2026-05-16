/**
 * End-to-end smoke test for the multi-contact split feature.
 * Drives the live dev server at http://localhost:3003 with the same
 * NextAuth session cookie a logged-in browser would carry.
 *
 * Reads the cookie from /tmp/kj-cookies.txt (set up earlier with curl).
 * Run with: npx tsx scripts/smoke-test-splits.ts
 */
import { readFileSync } from "node:fs";

const HOST = "http://localhost:3003";

function loadCookieHeader(): string {
  const txt = readFileSync("/tmp/kj-cookies.txt", "utf8");
  const pairs: string[] = [];
  for (const line of txt.split("\n")) {
    const trimmed = line.replace(/^#HttpOnly_/, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;
    pairs.push(`${parts[5]}=${parts[6]}`);
  }
  return pairs.join("; ");
}

const COOKIE = loadCookieHeader();

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: COOKIE,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T };
}

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(`✗ ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("=== 0. Verify session ===");
  const sess = await req<{ user?: { id: string; activeWorkspaceId: string } }>(
    "GET",
    "/api/auth/session",
  );
  expect(!!sess.body.user, `Authenticated as user ${sess.body.user?.id ?? "?"}`);

  console.log("\n=== 1. Bootstrap: 1 account + 3 contacts ===");
  const acct = await req<{ id: string }>("POST", "/api/accounts", {
    kind: "BANK",
    name: `Smoke ${Date.now()}`,
    openingBalance: 50000,
  });
  expect(acct.status === 200, `account created: ${acct.body.id}`);

  const c1 = await req<{ id: string }>("POST", "/api/contacts", { name: "Ravi" });
  const c2 = await req<{ id: string }>("POST", "/api/contacts", { name: "Suresh" });
  const c3 = await req<{ id: string }>("POST", "/api/contacts", { name: "Meena" });
  expect(c1.status === 200, `Ravi=${c1.body.id}`);
  expect(c2.status === 200, `Suresh=${c2.body.id}`);
  expect(c3.status === 200, `Meena=${c3.body.id}`);

  console.log("\n=== 2. POST 3-way split ₹3000: Ravi+Suresh recoverable, Meena not ===");
  const txn = await req<{ id?: string; error?: string }>("POST", "/api/transactions", {
    type: "EXPENSE",
    amount: 3000,
    description: "Dinner with crew",
    date: "2026-05-16",
    accountId: acct.body.id,
    splits: [
      { contactId: c1.body.id, amount: 1000, isRecoverable: true },
      { contactId: c2.body.id, amount: 1000, isRecoverable: true },
      { contactId: c3.body.id, amount: 1000, isRecoverable: false },
    ],
  });
  if (!txn.body.id) {
    throw new Error(`txn POST failed: ${JSON.stringify(txn)}`);
  }
  expect(!!txn.body.id, `txn created: ${txn.body.id}`);

  console.log("\n=== 3. GET detail — verify splits ===");
  type Detail = {
    transaction: {
      amount: number;
      beneficiary: { id: string } | null;
      memberChargeType: string;
      splits: Array<{
        contact: { id: string; name: string };
        amount: number;
        isRecoverable: boolean;
        charge: { id: string; status: string; settledAmount: number } | null;
      }>;
    };
  };
  const detail = await req<Detail>("GET", `/api/transactions/${txn.body.id}`);
  expect(detail.status === 200, "detail returned 200");
  const t = detail.body.transaction;
  expect(t.splits.length === 3, `3 splits on the transaction`);
  expect(t.beneficiary === null, `legacy beneficiary is null (multi-split, Q5)`);
  expect(t.memberChargeType === "RECOVERABLE", `memberChargeType=RECOVERABLE`);
  const ravi = t.splits.find((s) => s.contact.id === c1.body.id)!;
  const suresh = t.splits.find((s) => s.contact.id === c2.body.id)!;
  const meena = t.splits.find((s) => s.contact.id === c3.body.id)!;
  expect(ravi.isRecoverable && !!ravi.charge, "Ravi's split is recoverable + has charge");
  expect(suresh.isRecoverable && !!suresh.charge, "Suresh's split is recoverable + has charge");
  expect(!meena.isRecoverable && !meena.charge, "Meena's split is NOT recoverable + no charge");

  console.log("\n=== 4. Contact ledgers ===");
  type Ledger = {
    totals: { outstanding: number; settled: number; spentOnThem: number };
    charges: Array<{ id: string; amount: number; status: string }>;
    expenses: Array<{ id: string; amount: number; isPartialOfTotal: boolean }>;
  };
  const lr1 = await req<Ledger>("GET", `/api/contacts/${c1.body.id}/ledger`);
  expect(lr1.body.totals.outstanding === 1000, `Ravi outstanding=₹1000`);
  expect(lr1.body.charges.length === 1, `Ravi has 1 charge`);
  const lr2 = await req<Ledger>("GET", `/api/contacts/${c2.body.id}/ledger`);
  expect(lr2.body.totals.outstanding === 1000, `Suresh outstanding=₹1000`);
  const lr3 = await req<Ledger>("GET", `/api/contacts/${c3.body.id}/ledger`);
  expect(lr3.body.totals.outstanding === 0, `Meena outstanding=₹0`);
  expect(lr3.body.totals.spentOnThem === 1000, `Meena spentOnThem=₹1000`);
  expect(
    lr3.body.expenses.length === 1 && lr3.body.expenses[0].isPartialOfTotal,
    `Meena's spent-on-them flagged as partial-of-total`,
  );

  console.log("\n=== 5. Settle ₹500 of Ravi's charge ===");
  const settle = await req<{ ok?: boolean; error?: string }>(
    "POST",
    `/api/member-charges/${ravi.charge!.id}/settle`,
    { amount: 500, paidAt: "2026-05-17" },
  );
  expect(settle.status === 200, `settle response 200`);
  const lr1b = await req<Ledger>("GET", `/api/contacts/${c1.body.id}/ledger`);
  expect(lr1b.body.totals.outstanding === 500, `Ravi outstanding=₹500 after settle`);
  expect(lr1b.body.totals.settled === 500, `Ravi settled=₹500`);

  console.log("\n=== 6. PATCH: try to REMOVE Ravi (has settlement) — should fail ===");
  const badRemove = await req<{ error?: string }>("PATCH", `/api/transactions/${txn.body.id}`, {
    splits: [
      { contactId: c2.body.id, amount: 1000, isRecoverable: true },
      { contactId: c3.body.id, amount: 1000, isRecoverable: false },
    ],
  });
  expect(badRemove.status === 400, `PATCH rejected with 400`);
  expect(
    !!badRemove.body.error?.includes("Forgive"),
    `error message mentions Forgive: "${badRemove.body.error}"`,
  );

  console.log("\n=== 7. PATCH: change Suresh's amount 1000 → 1500 + Meena 1000 → 500 ===");
  const patch = await req<{ id?: string; error?: string }>(
    "PATCH",
    `/api/transactions/${txn.body.id}`,
    {
      amount: 3000,
      splits: [
        { contactId: c1.body.id, amount: 1000, isRecoverable: true },
        { contactId: c2.body.id, amount: 1500, isRecoverable: true },
        { contactId: c3.body.id, amount: 500, isRecoverable: false },
      ],
    },
  );
  expect(patch.status === 200, `PATCH ok`);
  const after = await req<Detail>("GET", `/api/transactions/${txn.body.id}`);
  const sureshAfter = after.body.transaction.splits.find((s) => s.contact.id === c2.body.id)!;
  expect(sureshAfter.amount === 1500, `Suresh now ₹1500`);
  expect(sureshAfter.charge!.status === "OUTSTANDING", `Suresh charge OUTSTANDING (status recomputed)`);
  const lr2b = await req<Ledger>("GET", `/api/contacts/${c2.body.id}/ledger`);
  expect(lr2b.body.totals.outstanding === 1500, `Suresh outstanding=₹1500 after patch`);

  console.log("\n=== 8. Forgive Suresh's remaining ₹1500 ===");
  const forgive = await req<{ ok?: boolean; error?: string }>(
    "POST",
    `/api/member-charges/${suresh.charge!.id}/forgive`,
  );
  expect(forgive.status === 200, `forgive response 200`);
  const lr2c = await req<Ledger & { charges: Array<{ id: string; status: string }> }>(
    "GET",
    `/api/contacts/${c2.body.id}/ledger`,
  );
  expect(lr2c.body.totals.outstanding === 0, `Suresh outstanding=₹0 after forgive`);
  const sureshCharge = lr2c.body.charges.find((c) => c.id === suresh.charge!.id);
  expect(sureshCharge?.status === "WRITTEN_OFF", `Suresh's charge now WRITTEN_OFF`);

  console.log("\n=== 9. PATCH: try to shrink Ravi below settled (settled=500, new amt=300) ===");
  const badShrink = await req<{ error?: string }>("PATCH", `/api/transactions/${txn.body.id}`, {
    splits: [
      { contactId: c1.body.id, amount: 300, isRecoverable: true },
      { contactId: c2.body.id, amount: 1500, isRecoverable: true },
      { contactId: c3.body.id, amount: 500, isRecoverable: false },
    ],
  });
  expect(badShrink.status === 400, `PATCH rejected with 400`);
  expect(
    !!badShrink.body.error?.includes("settled"),
    `error mentions settled: "${badShrink.body.error}"`,
  );

  console.log("\n=== 10. DELETE the transaction (Ravi has settled, Suresh forgiven, Meena info-only) ===");
  const del = await req<{ ok?: boolean }>("DELETE", `/api/transactions/${txn.body.id}`);
  expect(del.status === 200, "DELETE ok");
  const gone = await req<{ error?: string }>("GET", `/api/transactions/${txn.body.id}`);
  expect(gone.status === 404, "transaction is gone");

  console.log("\n=== 11. Post-delete contact state ===");
  const lr1c = await req<Ledger>("GET", `/api/contacts/${c1.body.id}/ledger`);
  // Ravi's charge had settlements → preserved as WRITTEN_OFF
  expect(lr1c.body.totals.outstanding === 0, `Ravi outstanding=₹0 after delete`);
  expect(
    lr1c.body.charges.length === 1 && lr1c.body.charges[0].status === "WRITTEN_OFF",
    `Ravi's charge preserved as WRITTEN_OFF (had settlement)`,
  );
  const lr2d = await req<Ledger>("GET", `/api/contacts/${c2.body.id}/ledger`);
  expect(
    lr2d.body.charges.length === 1 && lr2d.body.charges[0].status === "WRITTEN_OFF",
    `Suresh's already-forgiven charge still present`,
  );
  const lr3b = await req<Ledger>("GET", `/api/contacts/${c3.body.id}/ledger`);
  expect(
    lr3b.body.expenses.length === 0 && lr3b.body.totals.spentOnThem === 0,
    `Meena's info-only split gone with the transaction`,
  );

  console.log("\n=== 12. Q1 check: try to delete a contact with charges (Suresh) ===");
  const delContact = await req<{ error?: string }>("DELETE", `/api/contacts/${c2.body.id}`);
  // Either the API returns a clear error (preferred), OR Prisma's Restrict throws
  // and bubbles as a 500. Both prove the constraint is enforced.
  if (delContact.status === 200) {
    throw new Error(
      `Contact delete unexpectedly succeeded — Restrict FK should have blocked it`,
    );
  }
  expect(
    delContact.status >= 400,
    `Contact delete blocked (HTTP ${delContact.status})`,
  );

  console.log("\n🎉 All assertions passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
