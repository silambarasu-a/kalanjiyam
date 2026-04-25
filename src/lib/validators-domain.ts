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
