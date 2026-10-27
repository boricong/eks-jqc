import {
  currentTeamQualifications,
  qualificationUseErrors,
  renewalQualificationErrors,
  type State,
  type Qualification,
} from "@eks/contracts";
import { demand } from "./errors.ts";
export function validateRenewalActivation(s: State, q: Qualification) {
  if (q.purpose !== "renewal") return;
  const errors = qualificationUseErrors(
    { ...q, lifecycleStatus: "Active" },
    s.courses,
  );
  demand(!errors.length, 409, errors.join(" · "));
  demand(
    !currentTeamQualifications(s).some(
      (p) =>
        p.lv1OrganizationId === q.lv1OrganizationId &&
        p.entityId !== q.entityId &&
        s.qualifications.some(
          (v) =>
            v.id === p.qualificationId &&
            v.purpose === "renewal" &&
            v.lifecycleStatus === "Active",
        ),
    ),
    409,
    "팀별 재인증용 Active 자격은 1개만 운영할 수 있습니다.",
  );
}
export function validateRenewalStructure(s: State) {
  demand(
    s.qualificationTemplates.filter((t) => t.purpose === "renewal").length <= 1,
    422,
    "재인증용 공통 기본자격은 1개만 생성할 수 있습니다.",
  );
  for (const t of s.qualificationTemplates.filter(
    (t) => t.purpose === "renewal",
  ))
    demand(
      t.qualificationType === "auditee" && t.scope !== "team",
      422,
      "재인증 기본자격은 시스템 Auditee여야 합니다.",
    );
  for (const q of s.qualifications) {
    const t = s.qualificationTemplates.find((t) => t.id === q.templateId);
    demand(
      (q.purpose || "acquisition") === (t?.purpose || "acquisition"),
      422,
      "기본자격과 팀 자격의 용도가 다릅니다.",
    );
  }
  for (const p of currentTeamQualifications(s)) {
    const q = s.qualifications.find((q) => q.id === p.qualificationId)!;
    if (q.purpose === "renewal" && q.lifecycleStatus === "Active") {
      demand(
        !renewalQualificationErrors(q, s.courses).length,
        422,
        "운영 중인 재인증 자격의 객관식 단독 구성을 확인해 주세요.",
      );
      demand(
        currentTeamQualifications(s).filter(
          (p) =>
            p.lv1OrganizationId === q.lv1OrganizationId &&
            s.qualifications.some(
              (v) =>
                v.id === p.qualificationId &&
                v.purpose === "renewal" &&
                v.lifecycleStatus === "Active",
            ),
        ).length === 1,
        422,
        "팀 재인증 운영 자격이 중복되었습니다.",
      );
    }
  }
  for (const r of s.organizationQualificationRequirements)
    demand(
      ![...r.entityIds, ...r.exclusions.map((e) => e.entityId)].some((id) =>
        s.qualifications.some(
          (q) => q.entityId === id && q.purpose === "renewal",
        ),
      ),
      422,
      "재인증용 자격은 조직 필요자격으로 지정할 수 없습니다.",
    );
}
