import type { UserView } from "./index.ts";
import type { OrganizationView } from "./organizations.ts";
import type { WorkStatusInfo } from "./work-status.ts";

export const teamEditableRoles = ["learner", "evaluator"] as const;
export type TeamEditableRole = (typeof teamEditableRoles)[number];
export interface TeamUserView extends UserView {
  workStatusInfo?: WorkStatusInfo;
  canEdit: boolean;
  editBlockedReason?: string;
}
export interface TeamUsersView {
  users: TeamUserView[];
  organizations: Pick<OrganizationView, "revision" | "entries">;
  editableRoles: TeamEditableRole[];
}
