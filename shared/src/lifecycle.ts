import { z } from "zod";
import { ValiditySchema, kstDate, type ValidityPolicy } from "./workflow.ts";

export const LifecycleStatusSchema = z.enum(["Active", "Hold", "Revoke"]);
export type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;
export const lifecycleLabels = {
  Active: "Active · 유효",
  Hold: "Hold · 정지",
  Revoke: "Revoke · 폐기",
};
export const criterionLifecycleLabels = {
  Active: "Active · 운영 중",
  Hold: "Hold · 운영 보류",
  Revoke: "Revoke · 운영 폐기",
};
export const RenewalNoticeDaysSchema = z.number().int().min(0).max(365);
export const RenewalLeadSchema = z.number().int().min(1).max(1200);
export const CertificationPeriodSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  kind: z.enum(["initial", "renewal"]),
  qualificationId: z.string(),
  qualificationVersion: z.number().int().positive(),
  validity: ValiditySchema,
  renewalLeadMonths: RenewalLeadSchema,
  renewalNoticeDaysBefore: RenewalNoticeDaysSchema.optional(),
  startsOn: z.iso.date(),
  baseOn: z.iso.date(),
  expiresOn: z.iso.date().optional(),
  completedAt: z.iso.datetime(),
  previousPeriodId: z.string().optional(),
  renewalId: z.string().optional(),
  source: z.enum(["issued", "migration"]),
});
export type CertificationPeriod = z.infer<typeof CertificationPeriodSchema>;
export const RenewalSchema = z.object({
  id: z.string(),
  certificationId: z.string(),
  periodId: z.string(),
  learnerId: z.string(),
  lv1OrganizationId: z.string(),
  qualificationId: z.string(),
  qualificationRevision: z.number().int().positive(),
  validity: ValiditySchema,
  renewalLeadMonths: RenewalLeadSchema,
  renewalNoticeDaysBefore: RenewalNoticeDaysSchema.optional(),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "completed", "closed"]),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  closedAt: z.iso.datetime().optional(),
  closeReason: z.string().optional(),
  method: z.literal("mvp_completion"),
});
export type Renewal = z.infer<typeof RenewalSchema>;
export const LifecycleEventSchema = z.object({
  id: z.string(),
  subject: z.enum(["qualification", "eligibility", "certification"]),
  targetId: z.string(),
  lv1OrganizationId: z.string(),
  actorId: z.string(),
  organizationId: z.string().optional(),
  action: z.string(),
  reason: z.string(),
  effectiveAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  before: z.json(),
  after: z.json(),
  assignmentId: z.string().optional(),
});
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>;

export function addCalendarMonths(on: string, months: number): string {
  const [y, m, d] = on.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d!, last));
  return first.toISOString().slice(0, 10);
}
export function addCalendarDays(on: string, days: number): string {
  return new Date(Date.parse(on) + days * 86400000).toISOString().slice(0, 10);
}
export function periodExpiry(baseOn: string, policy: ValidityPolicy) {
  return policy.type === "months" && policy.months
    ? addCalendarMonths(baseOn, policy.months)
    : undefined;
}
export function renewalOpensOn(
  p: Pick<
    CertificationPeriod,
    "expiresOn" | "startsOn" | "renewalLeadMonths" | "validity"
  >,
) {
  if (p.validity.type !== "months" || !p.expiresOn) return undefined;
  const calculated = addCalendarMonths(p.expiresOn, -p.renewalLeadMonths);
  return calculated < p.startsOn ? p.startsOn : calculated;
}
export function renewalNoticeOn(p: CertificationPeriod) {
  const opens = renewalOpensOn(p);
  if (!opens) return undefined;
  const calculated = addCalendarDays(opens, -(p.renewalNoticeDaysBefore ?? 7));
  return calculated < p.startsOn ? p.startsOn : calculated;
}
export function renewalPhase(
  c: CredentialState,
  at: string | Date = new Date(),
) {
  const p = latestPeriod(c);
  if (!p || effectiveCredentialStatus(c, at) !== "Active") return undefined;
  const opensOn = renewalOpensOn(p),
    noticeOn = renewalNoticeOn(p),
    today = kstDate(at);
  if (!opensOn || !noticeOn) return undefined;
  return {
    opensOn,
    noticeOn,
    state:
      today >= opensOn
        ? ("open" as const)
        : today >= noticeOn
          ? ("upcoming" as const)
          : ("scheduled" as const),
  };
}
export function expiryEffectiveAt(on: string): string {
  return new Date(`${addCalendarDays(on, 1)}T00:00:00+09:00`).toISOString();
}
export interface CredentialState {
  lifecycleStatus?: LifecycleStatus;
  validity?: ValidityPolicy;
  expiresOn?: string;
  periods?: CertificationPeriod[];
}
export function latestPeriod(c: CredentialState) {
  return c.periods?.at(-1);
}
export function effectiveCredentialStatus(
  c: CredentialState,
  at: string | Date = new Date(),
): LifecycleStatus {
  if (c.lifecycleStatus === "Revoke") return "Revoke";
  const period = latestPeriod(c),
    policy = period?.validity || c.validity;
  const end = period ? period.expiresOn : c.expiresOn;
  if (policy?.type === "months" && end && kstDate(at) > end) return "Revoke";
  if (!policy || policy.type === "unknown") return "Hold";
  return c.lifecycleStatus || "Active";
}
export function credentialCurrent(c: CredentialState) {
  const p = latestPeriod(c);
  return {
    validity: p?.validity || c.validity,
    expiresOn: p ? p.expiresOn : c.expiresOn,
  };
}
