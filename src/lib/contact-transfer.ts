import {
  MemberChargeDirection,
  MemberChargeStatus,
  MemberChargeType,
  TransactionType,
  type Prisma,
} from "@/generated/prisma/client";

/**
 * Creates one contact↔account transfer: the Transfer row, its single
 * Transaction leg, and — when the money is expected back — the MemberCharge
 * that records the obligation.
 *
 * Extracted from the two contact-side branches of `POST /api/transfers` so
 * the bulk-settle route can record a leftover payment the exact same way a
 * hand-entered transfer would. That matters more than the deduplication:
 * every reader in the app already understands this shape, so a leftover
 * lands in account balances, the contact statement, the ledger totals and
 * net worth without a single reader change.
 *
 * NOT used for account→account transfers — those need the card-statement
 * tagging that lives in the route.
 *
 * Must be called inside a `$transaction`; it makes 2-3 dependent writes.
 */
export type ContactTransferInput = {
  workspaceId: string;
  userId: string;
  contactId: string;
  contactName: string;
  accountId: string;
  amount: number;
  date: Date;
  notes: string | null;
  /** true = money leaves my account for the contact; false = they paid me. */
  outgoing: boolean;
  /** Record the mirroring MemberCharge. Outgoing → they owe me it back
   *  (OWED_TO_USER); incoming → I owe them (USER_OWES). */
  obligation: boolean;
  statementId?: string | null;
  /** Ties a bulk-settlement leftover back to the settlement it came with. */
  settlementTxnId?: string | null;
};

export type ContactTransferResult = {
  transferId: string;
  transactionId: string;
  memberChargeId: string | null;
};

export async function createContactTransfer(
  tx: Prisma.TransactionClient,
  input: ContactTransferInput,
): Promise<ContactTransferResult> {
  const {
    workspaceId,
    userId,
    contactId,
    contactName,
    accountId,
    amount,
    date,
    notes,
    outgoing,
    obligation,
    statementId = null,
    settlementTxnId = null,
  } = input;

  const transfer = await tx.transfer.create({
    data: {
      workspaceId,
      userId,
      fromAccountId: outgoing ? accountId : null,
      fromContactId: outgoing ? null : contactId,
      toAccountId: outgoing ? null : accountId,
      toContactId: outgoing ? contactId : null,
      amount,
      date,
      notes,
      statementId,
      // Only ever meaningful on an inbound transfer — it's the flag that
      // says "this money is theirs and I'll pay it back".
      createsObligation: obligation && !outgoing,
      settlementTxnId,
    },
  });

  if (outgoing) {
    // My account → person. Create the MemberCharge first so the leg and the
    // split can both point at it, which is what makes the contact's
    // Outstanding stat and the settle flow pick the amount up.
    let memberChargeId: string | null = null;
    if (obligation) {
      const mc = await tx.memberCharge.create({
        data: {
          workspaceId,
          beneficiaryContactId: contactId,
          amount,
          status: MemberChargeStatus.OUTSTANDING,
          notes,
        },
      });
      memberChargeId = mc.id;
    }
    const txn = await tx.transaction.create({
      data: {
        workspaceId,
        type: TransactionType.TRANSFER,
        amount,
        description: notes ?? `Transfer to ${contactName}`,
        date,
        accountId,
        beneficiaryContactId: contactId,
        memberChargeType: obligation
          ? MemberChargeType.RECOVERABLE
          : MemberChargeType.NONE,
        userId,
        createdByUserId: userId,
        transferId: transfer.id,
      },
    });
    // Mirror the contact link as a TransactionSplit so the splits-based
    // readers (contact ledger "spent on them", multi-split UI) see this
    // transfer just like any expense share.
    await tx.transactionSplit.create({
      data: {
        workspaceId,
        transactionId: txn.id,
        contactId,
        amount,
        isRecoverable: obligation,
        memberChargeId,
        notes,
      },
    });
    return { transferId: transfer.id, transactionId: txn.id, memberChargeId };
  }

  // Person → my account. Single leg on the destination account; the payer
  // lives on the Transfer row, not the leg, since beneficiaryContactId means
  // "money received by", which doesn't apply when the workspace is the
  // recipient.
  const txn = await tx.transaction.create({
    data: {
      workspaceId,
      type: TransactionType.TRANSFER,
      amount,
      description: notes ?? `Transfer from ${contactName}`,
      date,
      accountId,
      userId,
      createdByUserId: userId,
      transferId: transfer.id,
    },
  });
  // Money I need to pay back later → a USER_OWES charge linked to this
  // transfer. The settlement flow uses MemberChargeSettlement exactly as it
  // does for the other direction; only the cash flow reverses on settle.
  let memberChargeId: string | null = null;
  if (obligation) {
    const mc = await tx.memberCharge.create({
      data: {
        workspaceId,
        beneficiaryContactId: contactId,
        amount,
        status: MemberChargeStatus.OUTSTANDING,
        direction: MemberChargeDirection.USER_OWES,
        sourceTransferId: transfer.id,
        notes,
      },
    });
    memberChargeId = mc.id;
  }
  return { transferId: transfer.id, transactionId: txn.id, memberChargeId };
}
