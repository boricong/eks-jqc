import { z } from "zod";
import { addCalendarDays, addCalendarMonths } from "./lifecycle.ts";

export const WorkStatusSchema = z.enum(["active", "deactive"]);
export type WorkStatus = z.infer<typeof WorkStatusSchema>;
export const WorkDeactivationSchema = z.object({
  id: z.string(),
  startedAt: z.iso.datetime(),
  startedOn: z.iso.date(),
  revokesOn: z.iso.date(),
  actorId: z.string(),
  reason: z.string(),
  processedTeams: z.array(
    z.object({
      lv1OrganizationId: z.string(),
      processedAt: z.iso.datetime(),
    }),
  ),
});
export const workStatusLabels = {
  active: "active",
  deactive: "deactive",
};
export const WORK_DEACTIVE_MESSAGE =
  "Deactive · 업무 미수행 상태입니다. 관리자가 Active로 변경한 뒤 Auditee 절차를 진행할 수 있습니다.";
export function workRevokesOn(startedOn: string) {
  return addCalendarDays(addCalendarMonths(startedOn, 6), 1);
}
export function workDeactive(
  user: { workStatus?: WorkStatus },
  type: string = "auditee",
) {
  return type === "auditee" && user.workStatus === "deactive";
}
export interface WorkStatusInfo {
  status: WorkStatus;
  startedOn?: string;
  revokesOn?: string;
  reacquisitionRequired: boolean;
  canChange: boolean;
  canDeactivate: boolean;
  blockedReason?: string;
  validCertifications: number;
}
export interface WorkStatusPreview {
  token: string;
  expiresAt: string;
  current: WorkStatusInfo;
  next: WorkStatus;
  reason: string;
  revokesOn?: string;
  impacts: {
    certifications: number;
    requests: number;
    assignments: number;
    renewals: number;
  };
}
