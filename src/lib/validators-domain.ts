import { z } from "zod";

export const familyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  relationship: z.string().trim().max(40).optional(),
  dob: z.string().optional(),
  userId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const familyUpdateSchema = familyCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  types: z
    .array(z.enum(["INCOME", "EXPENSE", "INVESTMENT", "HAND_LOAN", "TRANSFER"]))
    .min(1),
  group: z.string().trim().max(40).optional().nullable(),
  icon: z.string().trim().max(40).optional().nullable(),
  // Two-level hierarchy: leave unset for top-level groups; set to the
  // id of an existing top-level Category for child categories. The API
  // enforces that the referenced parent itself has parentCategoryId =
  // null and that its `types` is a superset of the child's.
  parentCategoryId: z.string().min(1).max(64).optional().nullable(),
});

export const categoryUpdateSchema = categoryCreateSchema.partial();

const accountKindEnum = z.enum(["BANK", "CASH", "CARD", "WALLET"]);

export const accountCreateSchema = z.object({
  kind: accountKindEnum,
  name: z.string().trim().min(1).max(80),
  openingBalance: z.number().finite().default(0),
  creditLimit: z.number().finite().optional().nullable(),
  statementDate: z.number().int().min(1).max(31).optional().nullable(),
  gracePeriod: z.number().int().min(0).max(60).optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  ownerContactId: z.string().uuid().optional().nullable(),
  sharedWithUserIds: z.array(z.string().uuid()).optional(),
});

export const accountUpdateSchema = accountCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

const cardKindEnum = z.enum(["DEBIT", "CREDIT"]);
const cardNetworkEnum = z.enum(["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS", "OTHER"]);
const cardLimitModeEnum = z.enum(["SOLO", "SHARED"]);

export const cardCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: cardKindEnum,
  network: cardNetworkEnum.optional().default("OTHER"),
  supportsUpi: z.boolean().optional().default(false),
  last4: z.string().trim().max(4).optional().nullable(),
  parentAccountId: z.string().uuid().optional().nullable(),
  parentCardId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  limitMode: cardLimitModeEnum.optional().default("SOLO"),
  ownerUserId: z.string().uuid().optional().nullable(),
  ownerContactId: z.string().uuid().optional().nullable(),
  sharedWithUserIds: z.array(z.string().uuid()).optional(),
  creditLimit: z.number().finite().optional().nullable(),
  statementDate: z.number().int().min(1).max(31).optional().nullable(),
  gracePeriod: z.number().int().min(0).max(60).optional().nullable(),
  /** Existing outstanding on a CREDIT card at the time of creation. */
  openingBalance: z.number().nonnegative().optional().nullable(),
  /** Pre-existing bill due date for an already-generated statement. */
  nextBillDue: z.string().optional().nullable(),
  /** Pre-existing bill amount paired with nextBillDue. */
  nextBillAmount: z.number().nonnegative().optional().nullable(),
});

export const cardUpdateSchema = cardCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

/**
 * Hand-correct an already-materialised CardStatement. At least one of
 * `totalDue` / `dueDate` must be provided. Once applied, the materializer
 * will leave this row alone on subsequent runs.
 */
export const cardStatementEditSchema = z
  .object({
    totalDue: z.number().nonnegative().optional(),
    dueDate: z.string().optional(),
  })
  .refine(
    (o) => o.totalDue !== undefined || o.dueDate !== undefined,
    { message: "Provide totalDue or dueDate" },
  );

const transactionKindEnum = z.enum([
  "SALARY",
  "INTEREST",
  "AGRI_INCOME",
  "LEASE_INCOME",
  "OTHER_INCOME",
  "HOUSEHOLD",
  "GROCERY",
  "FARM_DEV",
  "WAGE",
  "FEED",
  "VACCINATION",
  "INVESTMENT",
  "LOAN_PAYMENT",
  "OTHER_EXPENSE",
  "REFUND",
]);

export const transactionSplitInputSchema = z.object({
  contactId: z.string().uuid(),
  amount: z.number().nonnegative(),
  sharePercent: z.number().min(0).max(100).optional().nullable(),
  isRecoverable: z.boolean().default(false),
  notes: z.string().trim().max(200).optional().nullable(),
});

export const transactionCreateSchema = z
  .object({
    // Optional client-minted UUID. When supplied, used as the row's id
    // so the instant-upload flow's draft attachments link without a
    // second round-trip. Server ignores if omitted (Prisma generates).
    clientId: z.string().uuid().optional().nullable(),
    type: z.enum(["INCOME", "EXPENSE", "INVESTMENT"]),
    kind: transactionKindEnum.optional().nullable(),
    amount: z.number().positive(),
    description: z.string().trim().min(1).max(200),
    date: z.string(),
    categoryId: z.string().uuid().optional().nullable(),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    workerId: z.string().uuid().optional().nullable(),
    cropBatchId: z.string().uuid().optional().nullable(),
    livestockBatchId: z.string().uuid().optional().nullable(),
    loanId: z.string().uuid().optional().nullable(),
    investmentId: z.string().uuid().optional().nullable(),
    investmentAction: z.enum(["BUY", "SELL"]).optional().nullable(),
    // When paying an insurance premium via the transaction dialog, the
    // caller passes the InvestmentReminder it's clearing so the route can
    // mark it CONFIRMED (instead of leaving a stale UPCOMING due). Optional
    // — ad-hoc premium pays without a specific reminder still advance the
    // policy's nextDueDate and confirm the earliest matching reminder.
    reminderId: z.string().uuid().optional().nullable(),
    // Paying an insurance premium in installments (EMI). `amount` is the
    // per-installment figure paid now (installment #1); the route seeds the
    // remaining installments as their own upcoming reminders. Only honoured
    // for INSURANCE BUY transactions.
    premiumEmi: z
      .object({
        installments: z.number().int().min(2).max(120),
        frequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"]),
      })
      .optional()
      .nullable(),
    investmentQty: z.number().positive().optional().nullable(),
    investmentPrice: z.number().positive().optional().nullable(),
    exchangeRate: z.number().positive().optional().nullable(),
    refundForTransactionId: z.string().uuid().optional().nullable(),
    beneficiaryContactId: z.string().uuid().optional().nullable(),
    memberChargeType: z.enum(["NONE", "RECOVERABLE", "GIFT"]).optional().default("NONE"),
    // When the workspace owner is recording an EXPENSE that a contact
    // actually paid (e.g. a friend covered dinner). No account / card
    // balance moves. When memberChargeType=RECOVERABLE, a MemberCharge
    // with direction=USER_OWES is created so the user can settle later.
    paidByContactId: z.string().uuid().optional().nullable(),
    vehicleId: z.string().uuid().optional().nullable(),
    claimId: z.string().uuid().optional().nullable(),
    hospitalizationId: z.string().uuid().optional().nullable(),
    hospitalizationStage: z.enum(["PRE", "DURING", "POST"]).optional().nullable(),
    eventId: z.string().uuid().optional().nullable(),
    // Fuel-fill metadata: optional. Unit is a short symbol ("L" /
    // "kWh" / "kg" / "m3") derived client-side from the vehicle's
    // fuelType at time of entry — stored so historical mileage calcs
    // remain correct if the vehicle is converted to a different fuel.
    fuelQuantity: z.number().positive().max(10_000).optional().nullable(),
    fuelUnit: z.string().trim().min(1).max(8).optional().nullable(),
    fuelOdometer: z.number().int().nonnegative().max(99_999_999).optional().nullable(),
    goldForm: z
      .enum(["ORNAMENT", "COIN", "BAR", "BISCUIT", "JEWELLERY_MAKING"])
      .optional()
      .nullable(),
    splits: z.array(transactionSplitInputSchema).max(50).optional().default([]),
  })
  .refine(
    (d) => !!d.accountId || !!d.cardId || !!d.paidByContactId,
    {
      message: "Pick an account, a card, or a contact who paid for it",
      path: ["accountId"],
    },
  )
  .refine(
    (d) => !d.paidByContactId || (!d.accountId && !d.cardId),
    {
      message:
        "When a contact paid for it, leave account and card empty — no balance moves on your side",
      path: ["paidByContactId"],
    },
  )
  .refine(
    (d) => !d.paidByContactId || d.type === "EXPENSE",
    {
      message: "Only expenses can be paid by a contact",
      path: ["paidByContactId"],
    },
  )
  .refine(
    (d) => !(d.paidByContactId && d.splits.length > 0),
    {
      message:
        "Splits and 'paid by contact' don't combine — pick one. If a friend paid AND others share the cost, record their settlements separately on the contact pages.",
      path: ["paidByContactId"],
    },
  )
  .refine(
    (d) =>
      !(
        d.memberChargeType === "RECOVERABLE" &&
        !d.beneficiaryContactId &&
        !d.paidByContactId &&
        d.splits.length === 0
      ),
    {
      // Three valid RECOVERABLE shapes:
      //   1. Single-beneficiary expense (legacy)     → beneficiaryContactId
      //   2. Multi-contact split with isRecoverable  → splits[]
      //   3. Contact-paid-for-me expense (new flow)  → paidByContactId
      // The refine only fires when NONE of these are present.
      message:
        "Pick a beneficiary, contact who paid, or a split for recoverable charges",
      path: ["beneficiaryContactId"],
    },
  )
  .refine((d) => d.splits.length === 0 || d.type === "EXPENSE", {
    message: "Splits are only allowed on expenses",
    path: ["splits"],
  })
  .refine(
    (d) => {
      if (d.splits.length === 0) return true;
      const sum = d.splits.reduce((s, x) => s + x.amount, 0);
      return sum <= d.amount + 0.005;
    },
    { message: "Splits cannot exceed transaction total", path: ["splits"] },
  )
  .refine(
    (d) => new Set(d.splits.map((s) => s.contactId)).size === d.splits.length,
    { message: "Each contact can appear only once in splits", path: ["splits"] },
  )
  .refine((d) => d.type !== "INVESTMENT" || (!!d.investmentId && !!d.investmentAction), {
    message: "Investment transaction needs a holding and action",
    path: ["investmentId"],
  })
  .refine((d) => d.kind !== "REFUND" || (d.type === "INCOME" && !!d.cardId), {
    message: "A refund must be income posted to a card",
    path: ["cardId"],
  });

export const transactionUpdateSchema = z.object({
  amount: z.number().positive().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  date: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  beneficiaryContactId: z.string().uuid().optional().nullable(),
  memberChargeType: z.enum(["NONE", "RECOVERABLE", "GIFT"]).optional(),
  // When present, the server diff-applies this set against existing
  // TransactionSplit rows. Omit the field to leave splits unchanged.
  splits: z.array(transactionSplitInputSchema).max(50).optional(),
  vehicleId: z.string().uuid().optional().nullable(),
  claimId: z.string().uuid().optional().nullable(),
  hospitalizationId: z.string().uuid().optional().nullable(),
  hospitalizationStage: z.enum(["PRE", "DURING", "POST"]).optional().nullable(),
  eventId: z.string().uuid().optional().nullable(),
  fuelQuantity: z.number().positive().max(10_000).optional().nullable(),
  fuelUnit: z.string().trim().min(1).max(8).optional().nullable(),
  fuelOdometer: z.number().int().nonnegative().max(99_999_999).optional().nullable(),
  goldForm: z
    .enum(["ORNAMENT", "COIN", "BAR", "BISCUIT", "JEWELLERY_MAKING"])
    .optional()
    .nullable(),
  editNote: z.string().trim().max(200).optional(),
});

export const transferCreateSchema = z
  .object({
    fromAccountId: z.string().uuid().optional().nullable(),
    fromContactId: z.string().uuid().optional().nullable(),
    toAccountId: z.string().uuid().optional().nullable(),
    toContactId: z.string().uuid().optional().nullable(),
    amount: z.number().positive(),
    date: z.string(),
    notes: z.string().trim().max(500).optional(),
    /** Marks the transfer as a recoverable outflow: creates a MemberCharge
     *  against the destination contact so the amount lands in their
     *  Outstanding stat. Only valid when sending FROM a workspace account
     *  TO a contact. */
    expectBack: z.boolean().optional().default(false),
    /** Marks an INBOUND transfer (FROM contact TO my account) as money I
     *  need to pay back later. Creates a MemberCharge with direction =
     *  USER_OWES so the contact's "I owe them" balance reflects it. */
    oweBack: z.boolean().optional().default(false),
  })
  .refine(
    (d) => !d.expectBack || (!!d.fromAccountId && !!d.toContactId),
    {
      message: "Expect-back only applies when sending from your account to a contact",
      path: ["expectBack"],
    },
  )
  .refine(
    (d) => !d.oweBack || (!!d.fromContactId && !!d.toAccountId),
    {
      message: "Owe-back only applies when receiving from a contact to your account",
      path: ["oweBack"],
    },
  )
  .refine(
    (d) => !(d.expectBack && d.oweBack),
    {
      message: "Pick one obligation direction",
      path: ["oweBack"],
    },
  )
  .refine((d) => !!d.fromAccountId !== !!d.fromContactId, {
    message: "Pick a source account or a person — exactly one",
    path: ["fromAccountId"],
  })
  .refine((d) => !!d.toAccountId !== !!d.toContactId, {
    message: "Pick a destination account or a person — exactly one",
    path: ["toAccountId"],
  })
  // At least one side must be an account — member-to-member transfers
  // don't touch this workspace's books and aren't representable.
  .refine((d) => !!d.fromAccountId || !!d.toAccountId, {
    message: "At least one side must be an account",
    path: ["toAccountId"],
  })
  .refine(
    (d) => !d.toAccountId || !d.fromAccountId || d.fromAccountId !== d.toAccountId,
    {
      message: "Pick two different accounts",
      path: ["toAccountId"],
    },
  );

export const memberChargeSettleSchema = z.object({
  amount: z.number().positive(),
  paidAt: z.string(),
  notes: z.string().trim().max(200).optional(),
  accountId: z.string().uuid().optional().nullable(),
});

export const landCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  area: z.number().positive().optional().nullable(),
  areaUnit: z.enum(["ACRES", "HECTARES", "CENTS", "SQFT", "SQM"]).optional().nullable(),
  location: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const landUpdateSchema = landCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

export const cropCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(40).optional(),
  description: z.string().trim().max(500).optional(),
});

export const cropUpdateSchema = cropCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

export const cropBatchCreateSchema = z.object({
  cropId: z.string().uuid(),
  landId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(80),
  status: z.enum(["PLANNED", "ACTIVE", "HARVESTED", "CLOSED"]).optional().default("ACTIVE"),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  expectedCycleDays: z.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const cropBatchUpdateSchema = cropBatchCreateSchema
  .partial()
  .omit({ cropId: true })
  .extend({
    active: z.boolean().optional(),
  });

export const livestockCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  species: z.string().trim().max(40).optional(),
  description: z.string().trim().max(500).optional(),
});

export const livestockUpdateSchema = livestockCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

const productionTypeEnum = z.enum([
  "BROILER_CONTRACT",
  "BROILER_INDEPENDENT",
  "LAYER",
  "COUNTRY_CHICKEN",
  "DAIRY",
  "MEAT_GOAT",
  "MEAT_SHEEP",
  "DUAL_PURPOSE",
]);

export const livestockBatchCreateSchema = z.object({
  livestockId: z.string().uuid(),
  landId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(80),
  productionType: productionTypeEnum.optional(),
  contractId: z.string().uuid().optional().nullable(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  expectedCycleDays: z.number().int().positive().optional().nullable(),
  initialCount: z.number().int().min(0),
  initialAvgWeight: z.number().positive().optional().nullable(),
  targetWeight: z.number().positive().optional().nullable(),
  targetFCR: z.number().positive().max(99).optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const livestockBatchUpdateSchema = livestockBatchCreateSchema
  .partial()
  .omit({ livestockId: true, initialCount: true })
  .extend({ active: z.boolean().optional() });

export const livestockEventCreateSchema = z
  .object({
    eventType: z.enum(["PURCHASE", "BIRTH", "DEATH", "SALE"]),
    date: z.string(),
    count: z.number().int().positive(),
    unitValue: z.number().nonnegative().optional().nullable(),
    avgWeightKg: z.number().positive().optional().nullable(),
    totalWeightKg: z.number().positive().optional().nullable(),
    notes: z.string().trim().max(500).optional(),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
  })
  .refine(
    (d) =>
      !["SALE", "PURCHASE"].includes(d.eventType) || d.unitValue != null,
    { message: "Sale/Purchase needs a unit value", path: ["unitValue"] }
  );

export const livestockEventUpdateSchema = z.object({
  // eventType + count drive head-count cascades; both are safely
  // editable here because the PATCH recomputes the count delta.
  eventType: z.enum(["PURCHASE", "BIRTH", "DEATH", "SALE"]).optional(),
  date: z.string().optional(),
  count: z.number().int().positive().optional(),
  // Editing money-affecting fields is forbidden when a Transaction is
  // already linked (same discipline as feed/milk/egg edits — re-pricing
  // means delete + recreate so the linked txn stays honest).
  unitValue: z.number().nonnegative().optional().nullable(),
  avgWeightKg: z.number().positive().optional().nullable(),
  totalWeightKg: z.number().positive().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const weighingLogCreateSchema = z.object({
  animalId: z.string().uuid().optional().nullable(),
  phase: z.enum(["ARRIVAL", "INTERIM", "WEEKLY", "EXIT"]),
  date: z.string(),
  sampleSize: z.number().int().positive().default(1),
  totalKg: z.number().positive(),
  notes: z.string().trim().max(500).optional(),
});
export const weighingLogUpdateSchema = weighingLogCreateSchema.partial();

export const mortalityLogCreateSchema = z.object({
  animalId: z.string().uuid().optional().nullable(),
  date: z.string(),
  count: z.number().int().positive().default(1),
  cause: z
    .enum([
      "UNKNOWN",
      "DISEASE",
      "PREDATOR",
      "INJURY",
      "HEAT",
      "COLD",
      "STAMPEDE",
      "OTHER",
    ])
    .default("UNKNOWN"),
  culled: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});
export const mortalityLogUpdateSchema = mortalityLogCreateSchema.partial();

export const livestockAnimalCreateSchema = z.object({
  tagNumber: z.string().trim().min(1).max(40),
  name: z.string().trim().max(80).optional().nullable(),
  sex: z.enum(["MALE", "FEMALE", "UNKNOWN"]).default("UNKNOWN"),
  dob: z.string().optional().nullable(),
  breed: z.string().trim().max(60).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});
export const livestockAnimalUpdateSchema = livestockAnimalCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });

// Json shape for the contract bonus / penalty tables. Kept as a Zod
// object so the API rejects garbage Json before it hits the database.
const fcrBonusBandSchema = z.object({
  maxFcr: z.number().positive(),
  bonusPerKg: z.number(),
});
const mortalityPenaltyBandSchema = z.object({
  overByPct: z.number().nonnegative(),
  deductPerKg: z.number().nonnegative(),
});

export const livestockContractCreateSchema = z.object({
  contactId: z.string().uuid().optional().nullable(),
  integratorName: z.string().trim().min(1).max(120),
  contractRef: z.string().trim().max(80).optional().nullable(),
  agreedRatePerKg: z.number().positive(),
  fcrBonusBands: z.array(fcrBonusBandSchema).optional().nullable(),
  mortalityCap: z.number().min(0).max(100).optional().nullable(),
  mortalityPenalty: z.array(mortalityPenaltyBandSchema).optional().nullable(),
  suppliesProvided: z.array(z.string().trim().max(40)).optional().default([]),
  notes: z.string().trim().max(500).optional(),
  startedOn: z.string(),
  endedOn: z.string().optional().nullable(),
});
export const livestockContractUpdateSchema = livestockContractCreateSchema
  .partial()
  .extend({ endedOn: z.string().optional().nullable() });

// `sessions` is a free-form Json bag (e.g. { MORNING: 12.5, EVENING: 11 })
// so a 2-session farm and a 3-session farm share the same shape. We
// only validate that values are non-negative numbers.
const milkSessionsSchema = z
  .record(z.string().min(1).max(20), z.number().nonnegative())
  .optional();

export const milkLogCreateSchema = z
  .object({
    animalId: z.string().uuid().optional().nullable(),
    date: z.string(),
    totalLitres: z.number().positive(),
    sessions: milkSessionsSchema,
    fatPct: z.number().min(0).max(20).optional().nullable(),
    snfPct: z.number().min(0).max(20).optional().nullable(),
    soldLitres: z.number().nonnegative().optional().nullable(),
    ratePerLitre: z.number().nonnegative().optional().nullable(),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (d) => (d.soldLitres ?? 0) <= d.totalLitres,
    {
      message: "Sold litres can't exceed total milked",
      path: ["soldLitres"],
    },
  )
  .refine(
    (d) => {
      // If sale info is provided, it must be complete enough to create
      // an INCOME Transaction. Either both soldLitres + ratePerLitre or
      // neither.
      const hasSold = (d.soldLitres ?? 0) > 0;
      const hasRate = (d.ratePerLitre ?? 0) > 0;
      return hasSold === hasRate;
    },
    {
      message: "Pair sold litres with a rate — or leave both empty",
      path: ["ratePerLitre"],
    },
  );

export const milkLogUpdateSchema = z
  .object({
    animalId: z.string().uuid().optional().nullable(),
    date: z.string().optional(),
    totalLitres: z.number().positive().optional(),
    sessions: milkSessionsSchema,
    fatPct: z.number().min(0).max(20).optional().nullable(),
    snfPct: z.number().min(0).max(20).optional().nullable(),
    soldLitres: z.number().nonnegative().optional().nullable(),
    ratePerLitre: z.number().nonnegative().optional().nullable(),
    notes: z.string().trim().max(500).optional(),
  });

// `grades` is a free-form Json bag (e.g. { SMALL: 12, MEDIUM: 80, ... })
// so the grade taxonomy can evolve without a schema bump.
const eggGradesSchema = z
  .record(z.string().min(1).max(20), z.number().int().nonnegative())
  .optional();

export const eggLogCreateSchema = z
  .object({
    date: z.string(),
    collected: z.number().int().positive(),
    grades: eggGradesSchema,
    broken: z.number().int().nonnegative().optional().nullable(),
    sold: z.number().int().nonnegative().optional().nullable(),
    salePricePerEgg: z.number().nonnegative().optional().nullable(),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (d) => (d.sold ?? 0) + (d.broken ?? 0) <= d.collected,
    {
      message: "Sold + broken can't exceed collected",
      path: ["sold"],
    },
  )
  .refine(
    (d) => {
      const hasSold = (d.sold ?? 0) > 0;
      const hasPrice = (d.salePricePerEgg ?? 0) > 0;
      return hasSold === hasPrice;
    },
    {
      message: "Pair sold count with a per-egg price — or leave both empty",
      path: ["salePricePerEgg"],
    },
  );

export const eggLogUpdateSchema = z.object({
  date: z.string().optional(),
  collected: z.number().int().positive().optional(),
  grades: eggGradesSchema,
  broken: z.number().int().nonnegative().optional().nullable(),
  sold: z.number().int().nonnegative().optional().nullable(),
  salePricePerEgg: z.number().nonnegative().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

// Lift event for broiler-contract batches. The integrator picks up
// the live birds and pays per kg; analytics computes the payout.
export const liftEventSchema = z.object({
  date: z.string(),
  count: z.number().int().positive(),
  totalWeightKg: z.number().positive(),
  // Where the integrator deposited the growing-charge cheque.
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  // When true, the endpoint flips the batch to active=false and stamps
  // endDate. Default true (lifting normally closes the cycle).
  closeBatch: z.boolean().default(true),
});

export const healthLogCreateSchema = z.object({
  animalId: z.string().uuid().optional().nullable(),
  date: z.string(),
  condition: z.string().trim().min(1).max(120),
  treatment: z.string().trim().max(500).optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  resolved: z.boolean().default(false),
  resolvedAt: z.string().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});
// Bulk-import historical batches. Each row creates one LivestockBatch
// under a Livestock parent (matched by name; auto-created if missing
// and the caller passes `createMissingLivestock=true`). Capped at 500
// rows per call to keep the $transaction reasonable.
const importBatchRowSchema = z.object({
  livestockName: z.string().trim().min(1).max(80),
  batchName: z.string().trim().min(1).max(80),
  productionType: productionTypeEnum.optional(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  expectedCycleDays: z.number().int().positive().optional().nullable(),
  initialCount: z.number().int().min(0),
  currentCount: z.number().int().min(0).optional(),
  initialAvgWeight: z.number().positive().optional().nullable(),
  targetWeight: z.number().positive().optional().nullable(),
  targetFCR: z.number().positive().max(99).optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
});
export const livestockBatchImportSchema = z.object({
  rows: z.array(importBatchRowSchema).min(1).max(500),
  createMissingLivestock: z.boolean().default(true),
});

// Bulk-import feed / weighings / mortality. All three reference a
// LivestockBatch by name (workspace-scoped) so the user can paste a
// CSV exported from a paper logbook. Rejects the whole batch on a
// single bad row.
const feedImportRowSchema = z.object({
  batchName: z.string().trim().min(1).max(80),
  date: z.string(),
  amount: z.number().positive(),
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});
const weighingImportRowSchema = z.object({
  batchName: z.string().trim().min(1).max(80),
  date: z.string(),
  phase: z.enum(["ARRIVAL", "INTERIM", "WEEKLY", "EXIT"]).default("INTERIM"),
  sampleSize: z.number().int().positive().default(1),
  totalKg: z.number().positive(),
  notes: z.string().trim().max(500).optional().nullable(),
});
const mortalityImportRowSchema = z.object({
  batchName: z.string().trim().min(1).max(80),
  date: z.string(),
  count: z.number().int().positive().default(1),
  cause: z
    .enum([
      "UNKNOWN",
      "DISEASE",
      "PREDATOR",
      "INJURY",
      "HEAT",
      "COLD",
      "STAMPEDE",
      "OTHER",
    ])
    .default("UNKNOWN"),
  culled: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional().nullable(),
});
export const livestockLogsImportSchema = z.object({
  entity: z.enum(["feed", "weighings", "mortality"]),
  rows: z
    .array(
      z.union([
        feedImportRowSchema,
        weighingImportRowSchema,
        mortalityImportRowSchema,
      ]),
    )
    .min(1)
    .max(1000),
});

export const healthLogUpdateSchema = z.object({
  animalId: z.string().uuid().optional().nullable(),
  date: z.string().optional(),
  condition: z.string().trim().min(1).max(120).optional(),
  treatment: z.string().trim().max(500).optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  resolved: z.boolean().optional(),
  resolvedAt: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const feedLogCreateSchema = z.object({
  date: z.string(),
  amount: z.number().positive(),
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
});
export const feedLogUpdateSchema = z.object({
  date: z.string().optional(),
  // Editing `amount` is forbidden when a Transaction is linked — the
  // linked txn carries the cashflow figure. Quantity / unit / notes
  // are safe to update.
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const vaccinationLogCreateSchema = z.object({
  vaccine: z.string().trim().min(1).max(80),
  date: z.string(),
  nextDueDate: z.string().optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
});
export const vaccinationLogUpdateSchema = z.object({
  vaccine: z.string().trim().min(1).max(80).optional(),
  date: z.string().optional(),
  nextDueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const workerCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).optional(),
  dailyRate: z.number().nonnegative().optional().nullable(),
  settlementCadence: z
    .enum(["AS_NEEDED", "WEEKLY", "MONTHLY", "CUSTOM"])
    .optional()
    .default("AS_NEEDED"),
  customCadenceDays: z.number().int().positive().optional().nullable(),
});

export const workerUpdateSchema = workerCreateSchema.partial().extend({
  active: z.boolean().optional(),
  archivedAt: z.string().optional().nullable(),
});

export const attendanceUpsertSchema = z.object({
  workerId: z.string().uuid(),
  date: z.string(),
  present: z.boolean(),
  dailyRateOverride: z.number().nonnegative().optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  rate: z.number().nonnegative().optional().nullable(),
  cropBatchId: z.string().uuid().optional().nullable(),
  livestockBatchId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

// Bulk: many workers, one date. The bulk-attendance modal sends one of
// these per selected date so each (worker × date) cell is one upsert.
export const attendanceBatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cropBatchId: z.string().uuid().optional().nullable(),
  livestockBatchId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  entries: z
    .array(
      z.object({
        workerId: z.string().uuid(),
        present: z.boolean().default(true),
        dailyRateOverride: z.number().nonnegative().optional().nullable(),
      })
    )
    .min(1),
});

export const wagePaymentCreateSchema = z.object({
  workerId: z.string().uuid(),
  amount: z.number().positive(),
  paidAt: z.string(),
  isBonus: z.boolean().optional().default(false),
  isAdvance: z.boolean().optional().default(false),
  notes: z.string().trim().max(500).optional(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
});

export const advanceRepaymentCreateSchema = z
  .object({
    workerId: z.string().uuid(),
    amount: z.number().positive().multipleOf(0.01).max(10_000_000),
    receivedAt: z.string(),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .refine((d) => !!d.accountId || !!d.cardId, {
    message: "Pick an account or a card to receive into",
    path: ["accountId"],
  })
  .refine((d) => new Date(d.receivedAt) <= new Date(Date.now() + 24 * 60 * 60 * 1000), {
    message: "Date cannot be in the future",
    path: ["receivedAt"],
  });

export const advanceRepaymentReverseSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});

export const wageSettlementSettleSchema = z.object({
  paymentAccountId: z.string().uuid().optional().nullable(),
  paymentCardId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(200).optional(),
});

const loanSourceEnum = z.enum(["BANK", "HAND_FORMAL", "CARD_EMI"]);
const loanKindEnum = z.enum([
  "PERSONAL",
  "HOME",
  "CAR",
  "GOLD",
  "BUSINESS",
  "EDUCATION",
  "CREDIT_CARD_LOAN",
  "OTHER",
]);
const loanFrequencyEnum = z.enum([
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
]);

export const goldLoanItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().int().positive().default(1),
  weightGrams: z.number().positive(),
  purity: z.number().int().min(1).max(24).optional().nullable(),
  notes: z.string().trim().max(200).optional().nullable(),
});

const loanFieldsSchema = z.object({
  kind: loanKindEnum.optional().default("PERSONAL"),
  source: loanSourceEnum,
  lender: z.string().trim().min(1).max(120),
  lenderContactId: z.string().uuid().optional().nullable(),
  borrower: z.string().trim().max(120).optional().nullable(),
  memberContactId: z.string().uuid().optional().nullable(),
  principal: z.number().positive(),
  outstanding: z.number().nonnegative().optional(),
  interestRate: z.number().nonnegative().optional().nullable(),
  gstOnInterest: z.number().nonnegative().optional().nullable(),
  emiAmount: z.number().positive().optional().nullable(),
  tenure: z.number().int().positive().optional().nullable(),
  frequency: loanFrequencyEnum.optional().default("MONTHLY"),
  charges: z.number().nonnegative().optional().nullable(),
  chargeBreakdown: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        amount: z.number().nonnegative(),
      })
    )
    .optional()
    .nullable(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  loanAccountNumber: z.string().trim().max(40).optional().nullable(),
  loanStatementDate: z.number().int().min(1).max(31).optional().nullable(),
  loanGracePeriod: z.number().int().min(0).max(60).optional().nullable(),
  isExisting: z.boolean().optional().default(false),
  startedAt: z.string(),
  maturityAt: z.string().optional().nullable(),
  nextDueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  goldItems: z.array(goldLoanItemSchema).optional(),
});

export const loanCreateSchema = loanFieldsSchema
  .refine((d) => d.source !== "CARD_EMI" || !!d.cardId, {
    message: "Card EMI needs a card",
    path: ["cardId"],
  })
  .refine((d) => d.source !== "HAND_FORMAL" || !!d.lenderContactId, {
    message: "Pick the contact you borrowed from",
    path: ["lenderContactId"],
  })
  // CREDIT_CARD_LOAN needs *either* a linked card (whose account provides
  // the billing cycle) *or* an explicit per-loan loanStatementDate (covers
  // standalone HDFC Jumbo-style loans where there's no parent card to pick).
  .refine(
    (d) =>
      d.kind !== "CREDIT_CARD_LOAN" || !!d.cardId || d.loanStatementDate != null,
    {
      message:
        "Credit card loan needs either a linked card or a statement-day override",
      path: ["cardId"],
    },
  );

export const loanUpdateSchema = loanFieldsSchema.partial().extend({
  active: z.boolean().optional(),
});

export const loanPaymentSchema = z.object({
  // Optional client-minted UUID for the resulting Transaction. Used by
  // the instant-upload flow so the dialog's draft attachments link
  // without a follow-up round trip.
  clientId: z.string().uuid().optional().nullable(),
  amount: z.number().positive(),
  paidAt: z.string(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  principalPortion: z.number().nonnegative().optional().nullable(),
  interestPortion: z.number().nonnegative().optional().nullable(),
  gstPortion: z.number().nonnegative().optional().nullable(),
  notes: z.string().trim().max(200).optional(),
});

export const handLoanMemberCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional(),
  familyMemberId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const handLoanMemberUpdateSchema = handLoanMemberCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

export const handLoanEntryCreateSchema = z.object({
  memberId: z.string().uuid(),
  direction: z.enum(["GIVEN", "RECEIVED"]),
  amount: z.number().positive(),
  date: z.string(),
  notes: z.string().trim().max(500).optional(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
});

const leaseFieldsSchema = z.object({
  direction: z.enum(["LEASED_OUT", "LEASED_IN"]),
  lessorContactId: z.string().uuid().optional().nullable(),
  lessorName: z.string().trim().max(120).optional().nullable(),
  lesseeContactId: z.string().uuid().optional().nullable(),
  lesseeName: z.string().trim().max(120).optional().nullable(),
  assetType: z.enum(["CROP_BATCH", "LIVESTOCK_BATCH"]),
  cropBatchId: z.string().uuid().optional().nullable(),
  livestockBatchId: z.string().uuid().optional().nullable(),
  amount: z.number().positive(),
  frequency: z.enum(["ONE_TIME", "YEARLY", "CUSTOM_MONTHS"]),
  customMonths: z.number().int().positive().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  notes: z.string().trim().max(500).optional(),
});

export const leaseCreateSchema = leaseFieldsSchema
  .refine(
    (d) =>
      (d.assetType === "CROP_BATCH" && !!d.cropBatchId) ||
      (d.assetType === "LIVESTOCK_BATCH" && !!d.livestockBatchId),
    { message: "Asset must match the chosen type", path: ["cropBatchId"] }
  )
  .refine(
    (d) => d.frequency !== "CUSTOM_MONTHS" || !!d.customMonths,
    { message: "Custom months required", path: ["customMonths"] }
  )
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date must be after start",
    path: ["endDate"],
  });

export const leaseUpdateSchema = leaseFieldsSchema.partial().extend({
  active: z.boolean().optional(),
});

export const leasePaymentConfirmSchema = z.object({
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  date: z.string().optional(),
  amount: z.number().positive().optional(),
  notes: z.string().trim().max(200).optional(),
});

const investmentKindEnum = z.enum([
  "STOCK",
  "FD",
  "RD",
  "MUTUAL_FUND",
  "SIP",
  "INSURANCE",
  "GOLD",
  "OTHER",
]);
const premiumFreqEnum = z.enum([
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "EVERY_2_YEARS",
  "EVERY_3_YEARS",
  "EVERY_5_YEARS",
  "ONE_TIME",
]);

const investmentCreateBase = z.object({
  kind: investmentKindEnum,
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).optional().nullable(),
  amount: z.number().positive(),
  currentValue: z.number().nonnegative().optional().nullable(),
  interestRate: z.number().nonnegative().optional().nullable(),
  startedAt: z.string(),
  maturityAt: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  symbol: z.string().trim().max(40).optional().nullable(),
  quantity: z.number().nonnegative().optional().nullable(),
  purchasePrice: z.number().nonnegative().optional().nullable(),
  purchaseExchangeRate: z.number().positive().optional().nullable(),
  exchange: z.string().trim().max(20).optional().nullable(),
  currency: z.enum(["INR", "USD"]).optional().nullable(),
  dividends: z.number().nonnegative().optional().nullable(),
  policyNumber: z.string().trim().max(80).optional().nullable(),
  policyType: z
    .enum([
      "LIFE",
      "HEALTH",
      "VEHICLE",
      "HOME",
      "TRAVEL",
      "TERM",
      "ULIP",
      "ENDOWMENT",
      "OTHER",
    ])
    .optional()
    .nullable(),
  premiumAmount: z.number().positive().optional().nullable(),
  premiumFrequency: premiumFreqEnum.optional().nullable(),
  sumAssured: z.number().positive().optional().nullable(),
  nextDueDate: z.string().optional().nullable(),
  nominee: z.string().trim().max(120).optional().nullable(),
  /** Kind-specific structured extras (e.g. for GOLD: type, purity, wastage, making, gst). */
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  /** Link a VEHICLE-type insurance policy to a Vehicle row. */
  vehicleId: z.string().uuid().optional().nullable(),
  /**
   * For GOLD investments only: form of the gold being bought. Stamped on
   * the BUY transaction(s) so reports can separate investment-grade gold
   * (COIN / BAR / BISCUIT) from ornaments routed through Expense.
   */
  goldForm: z.enum(["COIN", "BAR", "BISCUIT"]).optional().nullable(),
  // Life-insurance corporate fields. All optional — only meaningful when
  // policyType is LIFE / TERM / ULIP / ENDOWMENT.
  policyTermYears: z.number().int().positive().max(120).optional().nullable(),
  premiumPayingTermYears: z.number().int().positive().max(120).optional().nullable(),
  maturityValue: z.number().nonnegative().optional().nullable(),
  bonusAccrued: z.number().nonnegative().optional().nullable(),
  bonusLastRevisedAt: z.string().optional().nullable(),
  ridersJson: z
    .object({
      list: z.array(
        z.object({
          name: z.string().trim().min(1).max(80),
          sumAssured: z.number().nonnegative().optional().nullable(),
          notes: z.string().trim().max(200).optional(),
        }),
      ),
    })
    .optional()
    .nullable(),
  accountId: z.string().uuid().optional().nullable(),
  /**
   * Optional split-payment list. When present, replaces `accountId` — a BUY
   * transaction is created per split (e.g. ₹5L gold paid via 2 cards + 1
   * bank). Each split must reference exactly one of accountId/cardId, and
   * the split amounts must sum to `amount` (within ₹0.01 of rounding).
   */
  splits: z
    .array(
      z
        .object({
          accountId: z.string().uuid().optional().nullable(),
          cardId: z.string().uuid().optional().nullable(),
          amount: z.number().positive(),
        })
        .refine((s) => !!s.accountId !== !!s.cardId, {
          message: "Each split needs exactly one of accountId or cardId",
        }),
    )
    .min(1)
    .optional(),
  isExisting: z.boolean().optional().default(false),
  /** Pre-minted txn id from the instant-upload flow. Used as the seed
   *  BUY transaction's id when there's a single account-based payment
   *  (no splits) so receipts that were uploaded under this UUID link
   *  to the saved row without a follow-up round trip. */
  clientId: z.string().uuid().optional().nullable(),
});

export const investmentCreateSchema = investmentCreateBase.refine(
  (d) => {
    if (!d.splits) return true;
    const sum = d.splits.reduce((a, s) => a + s.amount, 0);
    return Math.abs(sum - d.amount) <= 0.01;
  },
  { message: "Split amounts must add up to the total", path: ["splits"] },
);

export const investmentUpdateSchema = investmentCreateBase.partial().extend({
  active: z.boolean().optional(),
});

export const investmentTradeSchema = z.object({
  amount: z.number().positive(),
  quantity: z.number().positive().optional().nullable(),
  pricePerUnit: z.number().positive().optional().nullable(),
  date: z.string(),
  accountId: z.string().uuid(),
  notes: z.string().trim().max(200).optional(),
});

export const reminderConfirmSchema = z.object({
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  amount: z.number().positive().optional(),
  date: z.string().optional(),
  notes: z.string().trim().max(200).optional(),
});

/**
 * Insured-member: a Contact covered under an insurance policy. For HEALTH
 * policies that's the patient; for future LIFE policies it'll be the
 * beneficiary (role discriminator lands in Phase 3). Premium fields are
 * optional — when null, the member inherits the policy's premiumAmount/
 * frequency. When set, they let one policy charge different premiums per
 * insured (common for family-floater health policies with age-based slabs).
 */
const insuredMemberBase = z.object({
  contactId: z.string().uuid(),
  premiumAmount: z.number().positive().optional().nullable(),
  premiumFrequency: premiumFreqEnum.optional().nullable(),
  sumAssured: z.number().positive().optional().nullable(),
  coverageStart: z.string().optional().nullable(),
  coverageEnd: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  role: z.enum(["INSURED", "BENEFICIARY"]).optional(),
  sharePercent: z.number().min(0).max(100).optional().nullable(),
});

export const insuredMemberCreateSchema = insuredMemberBase.refine(
  (d) => d.role !== "BENEFICIARY" || d.sharePercent != null,
  { message: "Beneficiary needs a share %", path: ["sharePercent"] },
);

export const insuredMemberUpdateSchema = insuredMemberBase
  .partial()
  .extend({ active: z.boolean().optional() });

const claimStatusEnum = z.enum([
  "FILED",
  "INTIMATED",
  "UNDER_REVIEW",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED",
  "PAID",
  "CLOSED",
]);

export const insuranceClaimCreateSchema = z.object({
  insuredMemberId: z.string().uuid().optional().nullable(),
  hospitalizationId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  claimNumber: z.string().trim().max(80).optional(),
  incidentDate: z.string(),
  filedAt: z.string().optional().nullable(),
  status: claimStatusEnum.optional(),
  claimedAmount: z.number().nonnegative().optional().nullable(),
  approvedAmount: z.number().nonnegative().optional().nullable(),
  receivedAmount: z.number().nonnegative().optional().nullable(),
  notes: z.string().trim().max(1000).optional(),
});

export const insuranceClaimUpdateSchema = insuranceClaimCreateSchema.partial();

const vehicleKindEnum = z.enum(["BIKE", "CAR", "TRACTOR", "TRUCK", "SCOOTER", "OTHER"]);

const vehicleFuelTypeEnum = z.enum([
  "PETROL",
  "DIESEL",
  "CNG",
  "LPG",
  "ELECTRIC",
  "HYBRID",
  "OTHER",
]);

export const vehicleCreateSchema = z.object({
  ownerContactId: z.string().uuid(),
  kind: vehicleKindEnum,
  name: z.string().trim().min(1).max(80),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  registrationNo: z.string().trim().max(40).optional(),
  fuelType: vehicleFuelTypeEnum.optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  purchasePrice: z.number().positive().optional().nullable(),
  odometerStart: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const vehicleUpdateSchema = vehicleCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });

export const hospitalizationCreateSchema = z.object({
  patientContactId: z.string().uuid(),
  hospitalName: z.string().trim().min(1).max(120),
  diagnosis: z.string().trim().max(200).optional(),
  admittedAt: z.string(),
  dischargedAt: z.string().optional().nullable(),
  notes: z.string().trim().max(1000).optional(),
});

export const hospitalizationUpdateSchema = hospitalizationCreateSchema.partial();

const vehicleDocumentKindEnum = z.enum([
  "RC",
  "FC",
  "PUC",
  "ROAD_TAX",
  "INSURANCE_COPY",
  "OTHER",
]);

export const vehicleDocumentCreateSchema = z.object({
  kind: vehicleDocumentKindEnum,
  label: z.string().trim().max(80).optional().nullable(),
  number: z.string().trim().max(80).optional().nullable(),
  issuedAt: z.string().optional().nullable(),
  expiryAt: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const vehicleDocumentUpdateSchema = vehicleDocumentCreateSchema.partial();

/* ---- Generic Attachment schemas (polymorphic per AttachmentOwnerKind) ---- */

const attachmentOwnerKindEnum = z.enum([
  "VEHICLE_DOCUMENT",
  "INSURANCE_POLICY",
  "CARD_STATEMENT",
  "TRANSACTION_RECEIPT",
  "CROP_BATCH_BILL",
  "LOAN_DOCUMENT",
  "INCOME_PROOF",
  "CONTACT_DOCUMENT",
  "EVENT_DOCUMENT",
  "UTILITY_BILL",
  "SUBSCRIPTION_DOCUMENT",
]);

export const attachmentUploadUrlSchema = z.object({
  ownerKind: attachmentOwnerKindEnum,
  ownerId: z.string().min(1).max(64),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
  // Hard ceiling 50 MB; per-kind policy enforces tighter limits server-side.
  size: z.number().int().positive().max(50_000_000),
  // When true, skip the owner-exists check. Used by the instant-upload
  // flow where the client mints a UUID up-front and uses it both as the
  // attachment owner and as the row id of the not-yet-created parent.
  draft: z.boolean().optional(),
});

export const attachmentFinalizeSchema = z.object({
  ownerKind: attachmentOwnerKindEnum,
  ownerId: z.string().min(1).max(64),
  s3Key: z.string().min(1).max(1024),
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive().max(50_000_000),
  checksum: z.string().trim().min(1).max(128).optional().nullable(),
  draft: z.boolean().optional(),
});

export const attachmentListQuerySchema = z.object({
  ownerKind: attachmentOwnerKindEnum,
  ownerId: z.string().min(1).max(64),
});

/* ---------------- Event / Trip schemas ---------------- */

const eventKindEnum = z.enum([
  "TRIP",
  "FUNCTION",
  "FESTIVAL",
  "PROJECT",
  "MEDICAL",
  "OTHER",
]);

export const eventCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: eventKindEnum.default("TRIP"),
    startedAt: z.string().min(1),
    endedAt: z.string().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    budget: z.number().nonnegative().optional().nullable(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) => !v.endedAt || new Date(v.endedAt) >= new Date(v.startedAt),
    { message: "End date can't be before start date", path: ["endedAt"] },
  );

export const eventUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: eventKindEnum.optional(),
    startedAt: z.string().min(1).optional(),
    endedAt: z.string().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    budget: z.number().nonnegative().optional().nullable(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) => !v.startedAt || !v.endedAt || new Date(v.endedAt) >= new Date(v.startedAt),
    { message: "End date can't be before start date", path: ["endedAt"] },
  );

/* ---------------- Per-contact bulk settlement ---------------- */

/**
 * Settle one or more outstanding MemberCharge rows belonging to a single
 * contact in a single round-trip. Each line carries a partial or full
 * amount; the server creates ONE Transaction (INCOME or EXPENSE based
 * on the direction of the charges) plus one MemberChargeSettlement
 * per line. All charges must share the same `direction` so a single
 * cash flow makes sense.
 */
export const contactBulkSettleSchema = z.object({
  lines: z
    .array(
      z.object({
        chargeId: z.string().uuid(),
        amount: z.number().positive(),
      }),
    )
    .min(1)
    .max(50),
  /** Account or card cash flows through. Required — without it the
   *  settlements are purely audit and don't move money, which is fine
   *  if the user picks "no cash flow" — we still record the settlements. */
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  paidAt: z.string().min(1),
  notes: z.string().trim().max(200).optional().nullable(),
});

/* ---------------- Subscription schemas ---------------- */

const subscriptionCycleEnum = z.enum([
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
]);

const subscriptionStatusEnum = z.enum(["ACTIVE", "PAUSED", "CANCELLED"]);

const subscriptionBase = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(10_000_000),
  cycle: subscriptionCycleEnum,
  nextBillingDate: z.string().min(1),
  startedOn: z.string().min(1),
  endsOn: z.string().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  autoPay: z.boolean().optional().default(false),
  categoryId: z.string().uuid().optional().nullable(),
  logoUrl: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: subscriptionStatusEnum.optional().default("ACTIVE"),
});

export const subscriptionCreateSchema = subscriptionBase
  .refine((d) => !!d.accountId !== !!d.cardId, {
    message: "Pick exactly one payment source — account or card",
    path: ["accountId"],
  })
  .refine((d) => !d.endsOn || new Date(d.endsOn) >= new Date(d.startedOn), {
    message: "End date can't be before start date",
    path: ["endsOn"],
  });

export const subscriptionUpdateSchema = subscriptionBase
  .partial()
  .refine(
    (d) => {
      if (d.accountId === undefined && d.cardId === undefined) return true;
      const acc = !!d.accountId;
      const card = !!d.cardId;
      return acc !== card;
    },
    { message: "Pick exactly one payment source", path: ["accountId"] },
  );

export const subscriptionPaySchema = z.object({
  // The schedule row being confirmed. Optional — server falls back to
  // the soonest UPCOMING row when omitted.
  scheduleId: z.string().uuid().optional().nullable(),
  // Optional override of the master amount (e.g. pro-rated charge).
  amount: z.number().positive().max(10_000_000).optional(),
  // Optional override of the payment source.
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  paidOn: z.string().optional().nullable(),
  notes: z.string().trim().max(200).optional().nullable(),
});

export const subscriptionSkipSchema = z.object({
  scheduleId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().max(200).optional().nullable(),
});

export const subscriptionListQuerySchema = z.object({
  status: subscriptionStatusEnum.optional(),
  cycle: subscriptionCycleEnum.optional(),
  search: z.string().trim().max(120).optional(),
});

/* ---------------- Utility provider / bill schemas ---------------- */

const utilityKindEnum = z.enum([
  "ELECTRICITY",
  "INTERNET",
  "MOBILE_POSTPAID",
  "MOBILE_PREPAID",
  "DTH",
  "GAS",
  "WATER",
  "OTHER",
]);

const utilityProviderStatusEnum = z.enum(["ACTIVE", "INACTIVE"]);
const utilityBillCycleEnum = z.enum([
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
]);
const utilityAmountModeEnum = z.enum(["FIXED", "VARIABLE"]);

// NOTE: fields here are `.optional()` WITHOUT `.default()` on purpose.
// `utilityProviderUpdateSchema` is `.partial()` and relies on an omitted
// field parsing to `undefined` so the PATCH route can merge over the
// existing row. In Zod 4 a `.default()` survives `.partial()` and would
// turn every omitted field into its default — silently forcing prepaid/
// recurring/autoPay off and resetting status on a partial update. The
// create route supplies its own `?? fallback` for every field, so no
// default is needed here.
const utilityProviderBase = z.object({
  kind: utilityKindEnum,
  providerName: z.string().trim().min(1).max(120),
  connectionNumber: z.string().trim().max(80).optional().nullable(),
  addressLine: z.string().trim().max(240).optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  autoPay: z.boolean().optional(),
  autoPayLeadDays: z.number().int().min(0).max(31).optional(),
  defaultDueDay: z.number().int().min(1).max(31).optional().nullable(),
  // Days after the statement date until the bill is due (grace period).
  // When set it takes precedence over defaultDueDay.
  gracePeriodDays: z.number().int().min(0).max(90).optional().nullable(),
  // Recurrence config.
  recurring: z.boolean().optional(),
  billingCycle: utilityBillCycleEnum.optional(),
  billingDay: z.number().int().min(1).max(31).optional().nullable(),
  amountMode: utilityAmountModeEnum.optional(),
  defaultAmount: z.number().positive().max(10_000_000).optional().nullable(),
  status: utilityProviderStatusEnum.optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  // Prepaid mode — validity-clock connections (JioAirFiber, mobile
  // prepaid). Paid up front; no postpaid bill or autopay. `validUntil`
  // is the current expiry; `rechargeValidityDays` prefills the recharge
  // dialog. Mutually exclusive with `recurring` (see prepaidNotRecurring).
  prepaid: z.boolean().optional(),
  validUntil: z.string().optional().nullable(),
  rechargeValidityDays: z.number().int().min(1).max(3650).optional().nullable(),
});

// A FIXED recurring provider must carry a default amount so both the
// generator and autopay know what to charge.
function fixedNeedsAmount(d: {
  recurring?: boolean;
  amountMode?: "FIXED" | "VARIABLE";
  defaultAmount?: number | null;
}): boolean {
  if (!d.recurring || d.amountMode !== "FIXED") return true;
  return d.defaultAmount != null && d.defaultAmount > 0;
}

// Prepaid and recurring-postpaid are two different billing worlds — a
// prepaid connection is paid up front and never generates a bill, so it
// can't also be `recurring`.
function prepaidNotRecurring(d: {
  prepaid?: boolean;
  recurring?: boolean;
}): boolean {
  return !(d.prepaid && d.recurring);
}

export const utilityProviderCreateSchema = utilityProviderBase
  .refine(
    (d) => {
      if (!d.accountId && !d.cardId) return true; // default source is optional
      return !!d.accountId !== !!d.cardId;
    },
    { message: "Pick exactly one default source — account or card", path: ["accountId"] },
  )
  .refine(fixedNeedsAmount, {
    message: "Set a monthly amount for a fixed recurring bill",
    path: ["defaultAmount"],
  })
  .refine(prepaidNotRecurring, {
    message: "A prepaid connection can't also auto-generate bills",
    path: ["prepaid"],
  });

export const utilityProviderUpdateSchema = utilityProviderBase
  .partial()
  .refine(fixedNeedsAmount, {
    message: "Set a monthly amount for a fixed recurring bill",
    path: ["defaultAmount"],
  })
  .refine(prepaidNotRecurring, {
    message: "A prepaid connection can't also auto-generate bills",
    path: ["prepaid"],
  });

export const utilityAdvanceCreateSchema = z
  .object({
    amount: z.number().positive().max(10_000_000),
    date: z.string().min(1),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(200).optional().nullable(),
  })
  .refine((d) => !!d.accountId !== !!d.cardId, {
    message: "Pick exactly one source — account or card",
    path: ["accountId"],
  });

// Recharge a prepaid connection. Records the up-front payment and extends
// the provider's validity. The new expiry is derived from EITHER an
// explicit `validUntil` date OR `validityDays` added to a base date; when
// `extendFromCurrent` (default) and the plan is still live, days stack
// onto the remaining validity instead of restarting from the pay date.
export const utilityRechargeSchema = z
  .object({
    amount: z.number().positive().max(10_000_000),
    validityDays: z.number().int().min(1).max(3650).optional().nullable(),
    validUntil: z.string().optional().nullable(),
    extendFromCurrent: z.boolean().optional().default(true),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    paidOn: z.string().optional().nullable(),
    notes: z.string().trim().max(200).optional().nullable(),
  })
  .refine(
    (d) => d.validityDays != null || !!(d.validUntil && d.validUntil.trim()),
    {
      message: "Set the plan validity in days, or pick an expiry date",
      path: ["validityDays"],
    },
  )
  .refine((d) => !d.accountId || !d.cardId, {
    message: "Pick at most one source",
    path: ["accountId"],
  });

export const utilityBillCreateSchema = z.object({
  clientId: z.string().uuid().optional().nullable(),
  providerId: z.string().uuid(),
  billDate: z.string().min(1),
  dueDate: z.string().min(1),
  billAmount: z.number().positive().max(10_000_000),
  previousReading: z.number().nonnegative().max(99_999_999).optional().nullable(),
  currentReading: z.number().nonnegative().max(99_999_999).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const utilityBillUpdateSchema = utilityBillCreateSchema.partial();

export const utilityBillPaySchema = z
  .object({
    advanceApplied: z.number().nonnegative().max(10_000_000).optional().default(0),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
    paidOn: z.string().optional().nullable(),
    notes: z.string().trim().max(200).optional().nullable(),
  })
  .refine(
    (d) => !d.accountId || !d.cardId,
    { message: "Pick at most one source", path: ["accountId"] },
  );

export const utilityBillListQuerySchema = z.object({
  providerId: z.string().uuid().optional(),
  status: z.enum(["paid", "unpaid", "overdue"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});

export const utilityProviderListQuerySchema = z.object({
  kind: utilityKindEnum.optional(),
  status: utilityProviderStatusEnum.optional(),
  search: z.string().trim().max(120).optional(),
});
