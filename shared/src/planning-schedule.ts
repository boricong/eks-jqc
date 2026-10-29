import { z } from "zod";
import { addCalendarMonths } from "./lifecycle.ts";
import { planErrors } from "./workflow.ts";
import type {
  PersonalPlan,
  Qualification,
  PlanningCandidate,
} from "./index.ts";

export function usesPlanningDeadline(
  q: Pick<Qualification, "qualificationType" | "purpose">,
) {
  return q.qualificationType === "auditee" && q.purpose !== "renewal";
}
export function planningDeadlineErrors(q: Qualification) {
  return usesPlanningDeadline(q) &&
    !z.number().int().min(1).max(1200).safeParse(q.planningDeadlineMonths)
      .success
    ? ["계획 확정 후 최대 완료 개월을 1~1,200 사이의 정수로 설정해 주세요."]
    : [];
}
export function planningWindow(q: Qualification, baseOn: string) {
  return usesPlanningDeadline(q) && q.planningDeadlineMonths
    ? {
        baseOn,
        months: q.planningDeadlineMonths,
        deadlineOn: addCalendarMonths(baseOn, q.planningDeadlineMonths),
      }
    : undefined;
}
export function scheduleFieldErrors(
  p: Pick<PersonalPlan, "startOn" | "endOn">,
  deadlineOn?: string,
) {
  const errors: Record<string, string> = {};
  if (!p.startOn) errors.startOn = "시작일을 입력해 주세요.";
  if (!p.endOn) errors.endOn = "완료일을 입력해 주세요.";
  if (p.startOn && p.endOn && p.startOn > p.endOn)
    errors.endOn = "완료일은 시작일 이후여야 합니다.";
  if (p.endOn && deadlineOn && p.endOn > deadlineOn)
    errors.endOn = `완료일은 ${deadlineOn} 이내여야 합니다.`;
  return errors;
}
export function deadlinePlanErrors(
  p: Pick<PersonalPlan, "startOn" | "endOn">,
  q: Qualification,
  baseOn: string,
) {
  return [
    ...planningDeadlineErrors(q),
    ...planErrors(p),
    ...(p.endOn &&
    planningWindow(q, baseOn)?.deadlineOn &&
    p.endOn > planningWindow(q, baseOn)!.deadlineOn
      ? [`완료일은 ${planningWindow(q, baseOn)!.deadlineOn} 이내여야 합니다.`]
      : []),
  ];
}
const id = z
  .string()
  .min(1)
  .max(160)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
export const ScheduleRowInputSchema = z
  .object({
    entityId: id,
    qualificationId: id,
    planId: id.optional(),
    revision: z.number().int().positive().optional(),
    startOn: z.union([z.literal(""), z.iso.date()]),
    endOn: z.union([z.literal(""), z.iso.date()]),
    goal: z.string().max(2000),
    reviewedCriteriaToken: z.string().optional(),
  })
  .strict();
export const ScheduleSaveInputSchema = z
  .object({
    requestRevision: z.number().int().positive(),
    rows: z.array(ScheduleRowInputSchema).max(1000),
  })
  .strict();
export type ScheduleRowInput = z.infer<typeof ScheduleRowInputSchema>;
export type ScheduleSaveInput = z.infer<typeof ScheduleSaveInputSchema>;
export interface ScheduleRow extends PlanningCandidate {
  qualification?: Qualification;
  previousQualification?: Qualification;
  plan?: PersonalPlan;
  required: boolean;
  editable: boolean;
  criteriaChanged: boolean;
  criteriaToken: string;
  window?: { baseOn: string; months: number; deadlineOn: string };
  startOn: string;
  endOn: string;
  goal: string;
  errors: Record<string, string>;
  courseTitles: string[];
}
export interface PlanningSchedule {
  requestId: string;
  requestRevision: number;
  serverDate: string;
  rows: ScheduleRow[];
  errors: string[];
  noAdditional: boolean;
  readOnly: boolean;
  canComplete: boolean;
  reviewToken?: string;
}
