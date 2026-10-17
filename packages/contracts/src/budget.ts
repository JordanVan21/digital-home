import { z } from "zod";
import { UUID, Money, LocalDate } from "./primitives";

/** Purchase ledger and roadmap contracts. See CONTRACTS.md §2, §6, §9. */
export const Purchase = z.object({
  id: UUID,
  objectId: UUID,
  assetId: UUID,
  cost: Money,
  priority: z.number().int(),
  dependencies: z.array(UUID),
});
export type Purchase = z.infer<typeof Purchase>;

export const Milestone = z.object({
  id: UUID,
  roomId: UUID,
  planId: UUID,
  date: LocalDate,
  title: z.string(),
  sceneVersionId: UUID,
  purchaseIds: z.array(UUID),
  periodSpend: Money,
  cumulativeSpend: Money,
});
export type Milestone = z.infer<typeof Milestone>;

export const PurchaseLedgerItem = z.object({
  id: UUID,
  targetObjectId: UUID,
  assetId: UUID,
  replacesObjectId: UUID.optional(),
  estimatedUnitCost: Money.nullable(),
  quantity: z.number().int().positive(),
  priceStatus: z.enum(["estimated", "verified", "unknown"]),
  priceSource: z.string().optional(),
  stageId: UUID.optional(),
});
export type PurchaseLedgerItem = z.infer<typeof PurchaseLedgerItem>;

export const RenovationPlan = z.object({
  id: UUID,
  roomId: UUID,
  desiredTargetVersionId: UUID,
  adjustedTargetVersionId: UUID.optional(),
  fundedFinalVersionId: UUID.optional(),
  baselineVersionId: UUID,
  purchases: z.array(PurchaseLedgerItem),
  totalSpendingCap: Money.optional(),
  monthlySpendingCap: Money.optional(),
  savingsContributionPerMonth: Money.optional(),
  startingCash: Money.optional(),
  startDate: z.string().optional(),
  estimateIncomplete: z.boolean(),
  unfundedPurchaseIds: z.array(UUID),
});
export type RenovationPlan = z.infer<typeof RenovationPlan>;
