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
  group: z.string().trim().max(40).optional(),
  icon: z.string().trim().max(40).optional(),
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
  ownerMemberId: z.string().uuid().optional().nullable(),
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
  accountId: z.string().uuid().optional().nullable(),
  limitMode: cardLimitModeEnum.optional().default("SOLO"),
  ownerUserId: z.string().uuid().optional().nullable(),
  ownerMemberId: z.string().uuid().optional().nullable(),
  sharedWithUserIds: z.array(z.string().uuid()).optional(),
  creditLimit: z.number().finite().optional().nullable(),
  statementDate: z.number().int().min(1).max(31).optional().nullable(),
  gracePeriod: z.number().int().min(0).max(60).optional().nullable(),
});

export const cardUpdateSchema = cardCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

export const transactionCreateSchema = z
  .object({
    type: z.enum(["INCOME", "EXPENSE"]),
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
    beneficiaryMemberId: z.string().uuid().optional().nullable(),
    memberChargeType: z.enum(["NONE", "RECOVERABLE", "GIFT"]).optional().default("NONE"),
  })
  .refine((d) => !!d.accountId || !!d.cardId, {
    message: "Pick an account or a card",
    path: ["accountId"],
  })
  .refine((d) => !(d.memberChargeType === "RECOVERABLE" && !d.beneficiaryMemberId), {
    message: "Pick a beneficiary for recoverable charges",
    path: ["beneficiaryMemberId"],
  });

export const transactionUpdateSchema = z.object({
  amount: z.number().positive().optional(),
  description: z.string().trim().min(1).max(200).optional(),
  date: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  beneficiaryMemberId: z.string().uuid().optional().nullable(),
  memberChargeType: z.enum(["NONE", "RECOVERABLE", "GIFT"]).optional(),
  editNote: z.string().trim().max(200).optional(),
});

export const transferCreateSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amount: z.number().positive(),
    date: z.string(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.fromAccountId !== d.toAccountId, {
    message: "Pick two different accounts",
    path: ["toAccountId"],
  });

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

export const livestockBatchCreateSchema = z.object({
  livestockId: z.string().uuid(),
  landId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(80),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  expectedCycleDays: z.number().int().positive().optional().nullable(),
  initialCount: z.number().int().min(0),
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
    notes: z.string().trim().max(500).optional(),
    accountId: z.string().uuid().optional().nullable(),
    cardId: z.string().uuid().optional().nullable(),
  })
  .refine(
    (d) =>
      !["SALE", "PURCHASE"].includes(d.eventType) || d.unitValue != null,
    { message: "Sale/Purchase needs a unit value", path: ["unitValue"] }
  );

export const feedLogCreateSchema = z.object({
  date: z.string(),
  amount: z.number().positive(),
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
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

export const workerCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(20).optional(),
  dailyRate: z.number().nonnegative().optional().nullable(),
  settlementCadence: z.enum(["WEEKLY", "MONTHLY", "CUSTOM"]).optional().default("MONTHLY"),
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
  "OTHER",
]);

const loanFieldsSchema = z.object({
  kind: loanKindEnum.optional().default("PERSONAL"),
  source: loanSourceEnum,
  lender: z.string().trim().min(1).max(120),
  borrower: z.string().trim().max(120).optional().nullable(),
  principal: z.number().positive(),
  outstanding: z.number().nonnegative().optional(),
  interestRate: z.number().nonnegative().optional().nullable(),
  gstOnInterest: z.number().nonnegative().optional().nullable(),
  emiAmount: z.number().positive().optional().nullable(),
  tenure: z.number().int().positive().optional().nullable(),
  frequency: z.string().optional(),
  charges: z.number().nonnegative().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  cardId: z.string().uuid().optional().nullable(),
  isExisting: z.boolean().optional().default(false),
  startedAt: z.string(),
  maturityAt: z.string().optional().nullable(),
  nextDueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
});

export const loanCreateSchema = loanFieldsSchema.refine(
  (d) => d.source !== "CARD_EMI" || !!d.cardId,
  { message: "Card EMI needs a card", path: ["cardId"] }
);

export const loanUpdateSchema = loanFieldsSchema.partial().extend({
  active: z.boolean().optional(),
});

export const loanPaymentSchema = z.object({
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
  lessorMemberId: z.string().uuid().optional().nullable(),
  lessorName: z.string().trim().max(120).optional().nullable(),
  lesseeMemberId: z.string().uuid().optional().nullable(),
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

const investmentKindEnum = z.enum(["STOCK", "FD", "MUTUAL_FUND", "SIP", "INSURANCE", "OTHER"]);
const premiumFreqEnum = z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "ONE_TIME"]);

export const investmentCreateSchema = z.object({
  kind: investmentKindEnum,
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).optional(),
  amount: z.number().positive(),
  currentValue: z.number().nonnegative().optional().nullable(),
  interestRate: z.number().nonnegative().optional().nullable(),
  startedAt: z.string(),
  maturityAt: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional(),
  symbol: z.string().trim().max(40).optional(),
  quantity: z.number().nonnegative().optional().nullable(),
  purchasePrice: z.number().nonnegative().optional().nullable(),
  exchange: z.string().trim().max(20).optional(),
  policyNumber: z.string().trim().max(80).optional(),
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
    .optional(),
  premiumAmount: z.number().positive().optional().nullable(),
  premiumFrequency: premiumFreqEnum.optional(),
  sumAssured: z.number().positive().optional().nullable(),
  nextDueDate: z.string().optional().nullable(),
  nominee: z.string().trim().max(120).optional(),
  accountId: z.string().uuid().optional().nullable(),
  isExisting: z.boolean().optional().default(false),
});

export const investmentUpdateSchema = investmentCreateSchema.partial().extend({
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
