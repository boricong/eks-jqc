import { validateRenewalBatches } from "./renewal-integrity.ts";
import { validateRenewalStructure } from "./renewal-criteria.ts";
import { validateReleases } from "./release-integrity.ts";
import { validateAuditorPool } from "./auditor-pool.ts";
import { validateRequirements } from "./organization-requirements.ts";
import { validateSubjective } from "./subjective.ts";
import { validateCommonSelection } from "./common-courses.ts";
import { validateCatalogStructure } from "./catalog-editing.ts";
import { validatePolicies } from "./organization-settings.ts";
import {
  StateSchema,
  LegacyStateSchema,
  assessmentQuestions,
  assessmentPassScore,
  courseErrors,
  qualificationErrors,
  requiredKinds,
  type State,
  type OrganizationDocument,
  organizationEntries,
} from "@eks/contracts";
import { validateWorkflow } from "./workflow-integrity.ts";
import { validateLifecycle } from "./lifecycle-integrity.ts";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`저장 데이터 무결성 오류: ${message}`);
}
export function validateState(
  input: unknown,
  organizations?: OrganizationDocument,
  legacy = false,
): State {
  if (!legacy && [25, 26, 27, 28, 29].includes((input as any)?.schemaVersion)) {
    const raw = input as any;
    for (const item of [
      ...(raw.courses || []),
      ...(raw.qualificationTemplates || []),
      ...(raw.qualifications || []),
      ...[
        ...(raw.plans || []),
        ...(raw.assignments || []),
        ...(raw.certifications || []),
      ].flatMap((r: any) =>
        r.qualificationMetadata ? [r.qualificationMetadata] : [],
      ),
    ])
      check(
        item.qualificationType === "auditee" ||
          item.qualificationType === "auditor",
        "업무16 인증 유형 누락 또는 알 수 없는 유형",
      );
  }
  if (!legacy)
    for (const r of (input as any)?.planningRequests || [])
      check(
        !Object.hasOwn(r, "targets"),
        "폐지된 요청 필수 대상은 명시적으로 이관해 주세요.",
      );
  if (!legacy)
    for (const p of (input as any)?.plans || [])
      check(
        !Object.hasOwn(p, "schedules") && !Object.hasOwn(p, "targetOn"),
        "인증Set별 계획은 명시적으로 이관해 주세요.",
      );
  if (!legacy && (input as any)?.schemaVersion >= 27)
    check(
      ((input as any).organizationQualificationRequirements || []).every(
        (r: any) => Array.isArray(r.exclusions),
      ),
      "업무27 상속 예외 필드 누락",
    );
  if (!legacy && (input as any)?.schemaVersion >= 28) {
    const raw = input as any;
    check(Array.isArray(raw.renewalBatches), "업무28 재인증 회차 필드 누락");
    // Older fixtures and imported archived criteria may omit the ordinary purpose;
    // explicit migration materializes it. Unknown values are rejected by the schema.
  }
  const s = (legacy
    ? LegacyStateSchema.parse(input)
    : StateSchema.parse(input)) as unknown as State;
  if (!legacy) {
    validateSubjective(s);
    if (s.schemaVersion >= 28) {
      validateRenewalStructure(s);
      validateRenewalBatches(s);
    }
    if (s.schemaVersion >= 26) validateReleases(s);
    if (organizations) validateRequirements(s, organizations);
    check(
      new Set(s.commonCourses.map((c) => c.id)).size === s.commonCourses.length,
      "공통인증Set ID 중복",
    );
    for (const c of s.commonCourses) {
      check(
        s.users.some((u) => u.id === c.createdBy) &&
          s.users.some((u) => u.id === c.updatedBy),
        "공통인증Set 작성자 누락",
      );
      validateCatalogStructure(s, "courses", {
        ...c,
        entityId: c.id,
        lv1OrganizationId: "system",
        version: 1,
        category: "specialized",
      });
    }
    for (const t of s.qualificationTemplates) {
      check(
        new Set(t.defaultCommonCourseIds).size ===
          t.defaultCommonCourseIds.length,
        "기본 공통 목록 중복",
      );
      check(
        t.defaultCommonCourseIds.every((id) =>
          s.commonCourses.some(
            (c) =>
              c.id === id &&
              c.operationalStatus === "active" &&
              c.qualificationType === t.qualificationType,
          ),
        ),
        "기본 공통 목록 참조 오류",
      );
      check(
        t.scope !== "team" || !t.defaultCommonCourseIds.length,
        "팀 소유 기본자격 공통 목록 변경 불가",
      );
    }
    for (const c of s.courses) {
      check(
        (c.category === "common") === !!c.commonCourseSource,
        "공통 분류·출처 불일치",
      );
      if (c.commonCourseSource)
        check(
          s.commonCourses.some(
            (x) =>
              x.id === c.commonCourseSource!.id &&
              x.revision >= c.commonCourseSource!.revision &&
              x.qualificationType === c.qualificationType,
          ),
          "공통 원본 참조 오류",
        );
      check(
        s.courses
          .filter((x) => x.entityId === c.entityId)
          .every(
            (x) =>
              x.category === c.category &&
              x.commonCourseSource?.id === c.commonCourseSource?.id,
          ),
        "인증Set 계보의 공통 출처 불일치",
      );
    }
    const qualificationOrder = new Map(
      s.qualifications.map((q, i) => [q.id, i]),
    );
    for (const q of s.qualifications) {
      check(
        new Set(q.commonCourseEntityIds).size ===
          q.commonCourseEntityIds.length,
        "공통 선택 범위 중복",
      );
      check(
        q.commonCourseEntityIds.every((id) =>
          s.courses.some(
            (c) =>
              c.entityId === id &&
              c.category === "common" &&
              c.lv1OrganizationId === q.lv1OrganizationId &&
              c.qualificationType === q.qualificationType,
          ),
        ),
        "공통 선택 범위 참조 오류",
      );
      check(
        !s.qualifications.some(
          (other) =>
            other.entityId !== q.entityId &&
            q.commonCourseEntityIds.some((id) =>
              other.commonCourseEntityIds.includes(id),
            ),
        ),
        "서로 다른 자격의 공통 사본 공유",
      );
      check(
        s.qualifications
          .filter((other) => other.entityId === q.entityId)
          .every(
            (other) =>
              (other.version ?? 0) > (q.version ?? 0) ||
              (other.version === null &&
                q.version === null &&
                qualificationOrder.get(other.id)! >
                  qualificationOrder.get(q.id)!) ||
              other.commonCourseEntityIds.every((id) =>
                q.commonCourseEntityIds.includes(id),
              ),
          ),
        "자격 계보의 기존 공통 선택 범위 누락",
      );
      validateCommonSelection(s, q);
    }

    check(
      new Set(s.auditorPrograms.map((p) => p.lv1OrganizationId)).size ===
        s.auditorPrograms.length,
      "Auditor 팀 운영 중복",
    );
    for (const t of s.qualificationTemplates) {
      if (t.scope === "team")
        check(
          t.ownerLv1OrganizationId &&
            t.auditorLevel &&
            t.qualificationType === "auditor",
          "팀 소유 자격 범위",
        );
      else check(!t.ownerLv1OrganizationId, "시스템 자격 소유 정보");
      if (t.scope === "team")
        check(
          s.qualifications
            .filter((q) => q.templateId === t.id)
            .every((q) => q.lv1OrganizationId === t.ownerLv1OrganizationId),
          "팀 소유 자격 교차 연결",
        );
    }
    check(
      new Set(
        s.qualificationTemplates
          .filter((t) => t.scope === "team")
          .map((t) => `${t.ownerLv1OrganizationId}:${t.auditorLevel}`),
      ).size ===
        s.qualificationTemplates.filter((t) => t.scope === "team").length,
      "팀 등급 계보 중복",
    );
    for (const p of s.auditorPrograms) {
      if (organizations)
        check(
          organizationEntries(organizations).some(
            (o) => o.id === p.lv1OrganizationId && o.level === 1,
          ),
          "Auditor 운영 팀 참조",
        );
      check(
        s.users.some((u) => u.id === p.updatedBy),
        "Auditor 기준 관리자 참조",
      );
      for (const level of ["general", "main"] as const) {
        const ref = p[level];
        if (!ref) continue;
        const t = s.qualificationTemplates.find((t) => t.id === ref.templateId),
          q = s.qualifications.find(
            (q) =>
              q.entityId === ref.entityId &&
              q.lv1OrganizationId === p.lv1OrganizationId,
          );
        check(
          t?.scope === "team" &&
            t.ownerLv1OrganizationId === p.lv1OrganizationId &&
            t.auditorLevel === level &&
            q?.templateId === t.id,
          "Auditor 적용 계보·등급·팀 연결",
        );
      }
    }
    for (const a of s.assignments.filter((a) => a.auditor)) {
      const q = s.qualifications.find((q) => q.id === a.qualificationId),
        t = s.qualificationTemplates.find((t) => t.id === q?.templateId);
      check(
        !a.planId &&
          a.createdBy === a.learnerId &&
          t?.auditorLevel === a.auditor!.level &&
          (a.auditor!.criteriaPolicy === "pool" ||
            t.ownerLv1OrganizationId === a.lv1OrganizationId) &&
          a.qualificationPolicySnapshot &&
          a.qualificationMetadata,
        "Auditor 자율 학습 근거",
      );
    }
    for (const c of s.certifications.filter((c) => c.auditor)) {
      const a = s.assignments.find((a) => a.id === c.assignmentId);
      check(
        a?.auditor?.level === c.auditor!.level &&
          a.auditor.kind === c.auditor!.kind,
        "Auditor 인증 등급 근거",
      );
      if (c.auditor!.level === "main" && c.auditor!.kind === "initial")
        check(
          s.certifications.some(
            (g) =>
              g.id === c.auditor!.prerequisiteCertificationId &&
              g.learnerId === c.learnerId &&
              g.auditor?.level === "general" &&
              (a?.auditor?.criteriaPolicy !== "pool" ||
                (s.assignments.find((x) => x.id === g.assignmentId)
                  ?.lv1OrganizationId === a.lv1OrganizationId &&
                  s.qualifications.find((q) => q.id === g.qualificationId)
                    ?.templateId === a.auditor.prerequisiteTemplateId)),
          ),
          "최초 메인 선행 인증 근거",
        );
    }
    validateAuditorPool(s);
    const templates = new Set(s.qualificationTemplates.map((t) => t.id));
    check(
      templates.size === s.qualificationTemplates.length,
      "기본자격 ID 중복",
    );
    const teams = new Map<string, string>();
    const lineages = new Map<string, string>();
    for (const q of s.qualifications) {
      check(templates.has(q.templateId), "기본자격 연결 누락");
      check(
        q.qualificationType ===
          s.qualificationTemplates.find((t) => t.id === q.templateId)!
            .qualificationType,
        "기본자격과 팀 자격 유형 불일치",
      );
      const key = `${q.lv1OrganizationId}:${q.templateId}`;
      check(
        !teams.has(key) || teams.get(key) === q.entityId,
        "팀 기본자격 계보 중복",
      );
      teams.set(key, q.entityId);
      check(
        !lineages.has(q.entityId) || lineages.get(q.entityId) === key,
        "자격 계보의 기본자격·팀 연결 변경",
      );
      lineages.set(q.entityId, key);
      check(
        q.templateRevision <=
          s.qualificationTemplates.find((t) => t.id === q.templateId)!.revision,
        "기본자격 수정 번호 참조",
      );
    }
  }
  for (const record of [...s.plans, ...s.assignments, ...s.certifications]) {
    if (record.qualificationMetadata)
      check(
        record.qualificationMetadata.qualificationType ===
          s.qualifications.find((q) => q.id === record.qualificationId)
            ?.qualificationType,
        "보존 자격 유형 불일치",
      );
  }
  if (!legacy) {
    const courseTypes = new Map<string, string>();
    for (const c of s.courses) {
      // An unused first release may have changed type in the second release.
      // Keep that original immutable content, but never allow a used release to change type.
      const second = s.courses.find(
        (v) => v.entityId === c.entityId && v.version === 2,
      );
      if (
        s.schemaVersion >= 26 &&
        c.version === 1 &&
        second?.releaseInfo?.kind === "minor" &&
        !s.qualifications.some((q) => q.courseIds.includes(c.id)) &&
        !s.enrollments.some((e) => e.courseId === c.id)
      )
        continue;
      check(
        !courseTypes.has(c.entityId) ||
          courseTypes.get(c.entityId) === c.qualificationType,
        "인증Set 계보 유형 불일치",
      );
      courseTypes.set(c.entityId, c.qualificationType);
    }
    for (const q of s.qualifications)
      for (const id of q.courseIds)
        check(
          s.courses.find((c) => c.id === id)?.qualificationType ===
            q.qualificationType,
          "자격과 인증Set 유형 불일치",
        );
    for (const p of s.plans)
      for (const item of p.previousSchedule?.schedules || [])
        check(
          s.courses.find((c) => c.id === item.courseId)?.qualificationType ===
            s.qualifications.find((q) => q.id === p.qualificationId)
              ?.qualificationType,
          "계획 인증Set 유형 불일치",
        );
    for (const e of s.enrollments) {
      const a = s.assignments.find((a) => a.id === e.assignmentId);
      check(
        s.courses.find((c) => c.id === e.courseId)?.qualificationType ===
          s.qualifications.find((q) => q.id === a?.qualificationId)
            ?.qualificationType,
        "배정 인증Set 유형 불일치",
      );
    }
  }
  validateLifecycle(s);
  check(
    s.users.some((u) => u.roles.includes("system_operator")),
    "시스템 운영자 누락",
  );
  for (const user of s.users) {
    check(new Set(user.roles).size === user.roles.length, "역할 중복");
    if (user.organizationAdministration) {
      check(
        user.organizationAdministration.organizationId === user.organizationId,
        "관리 지정과 실제 소속 불일치",
      );
      check(
        s.users.some(
          (u) => u.id === user.organizationAdministration!.grantedBy,
        ),
        "관리 지정자 참조",
      );
    }
  }
  const entries = organizations ? organizationEntries(organizations) : [];
  const rootOf = (id: string) =>
    entries.find(
      (e) => e.id === s.users.find((u) => u.id === id)?.organizationId,
    )?.lv1OrganizationId;
  if (organizations) {
    validatePolicies(s, organizations);
    for (const user of s.users)
      check(
        entries.some((e) => e.id === user.organizationId),
        "사용자 조직 참조",
      );
    for (const record of [
      ...s.courses,
      ...s.qualifications,
      ...s.assignments,
      ...s.notices.filter((n) => n.scope === "team"),
      ...s.plans,
      ...s.planningRequests,
      ...s.notifications,
      ...s.catalogBatches,
      ...s.renewals,
      ...s.lifecycleEvents,
    ])
      check(
        entries.some((e) => e.id === record.lv1OrganizationId && e.level === 1),
        "Lv1 조직 참조",
      );
    for (const event of [...s.audits, ...s.requests])
      if (event.lv1OrganizationId)
        check(
          entries.some(
            (e) => e.id === event.lv1OrganizationId && e.level === 1,
          ),
          "이력 Lv1 참조",
        );
    for (const record of [...s.plans, ...s.planningRequests])
      check(
        rootOf(record.learnerId) === record.lv1OrganizationId,
        "계획 사용자 Lv1 불일치",
      );
  }
  for (const key of [
    "users",
    "courses",
    "qualifications",
    "assignments",
    "enrollments",
    "attempts",
    "subjectiveResponses",
    "completions",
    "certifications",
    "notices",
    "comparisons",
    "audits",
    "plans",
    "planningRequests",
    "learningRecords",
    "notifications",
    "catalogBatches",
    "renewals",
    "lifecycleEvents",
  ] as const)
    check(
      new Set(s[key].map((x) => x.id)).size === s[key].length,
      `${key} ID 중복`,
    );
  for (const list of [s.courses, s.qualifications])
    check(
      new Set(
        list.map(
          (x) => `${x.entityId}:${x.version === null ? x.id : x.version}`,
        ),
      ).size === list.length,
      "기준 버전 중복",
    );
  for (const list of [s.courses, s.qualifications]) {
    for (const item of list) {
      if (item.deletedAt)
        check(
          item.deletionReason?.trim() &&
            s.users.some((u) => u.id === item.deletedBy),
          "삭제 기준의 사유·실행자 누락",
        );
      else
        check(
          !item.deletedBy && !item.deletionReason,
          "삭제 일시 없는 삭제 정보",
        );
      if (item.parentId)
        check(
          list.some(
            (parent) =>
              parent.id === item.parentId &&
              parent.entityId === item.entityId &&
              parent.lv1OrganizationId === item.lv1OrganizationId &&
              parent.version !== null &&
              item.version !== null &&
              parent.version < item.version,
          ),
          "기준 버전 계보",
        );
    }
  }
  for (const q of s.qualifications) {
    check(
      (q.version === null) === (q.lifecycleStatus === "Ready"),
      "Ready 자격의 버전·상태 불일치",
    );
    if (q.version === null) {
      check(
        q.qualificationType === "auditee" && !q.parentId,
        "Ready 최초 등록 계보 불일치",
      );
      check(
        !s.qualifications.some(
          (other) => other.entityId === q.entityId && other.version !== null,
        ) || !!q.deletedAt,
        "번호 있는 계보의 Ready 등록",
      );
      check(
        q.deletedAt ||
          s.qualifications.filter(
            (other) =>
              other.entityId === q.entityId &&
              other.version === null &&
              !other.deletedAt,
          ).length === 1,
        "현재 Ready 등록 중복",
      );
      check(
        ![
          ...s.plans,
          ...s.assignments,
          ...s.certifications,
          ...s.renewals,
        ].some((r) => r.qualificationId === q.id),
        "Ready 자격의 업무 근거 참조",
      );
      check(
        !s.planningRequests.some((r) =>
          (r.selections || []).some((t) => t.qualificationId === q.id),
        ),
        "Ready 자격의 계획 요청 참조",
      );
    }
  }
  for (const c of s.courses) {
    if (c.operationalStatus === "retired")
      check(
        c.retiredAt &&
          c.retirementReason &&
          s.users.some((u) => u.id === c.retiredBy),
        "인증Set 운영 종료 근거",
      );
    else
      check(
        !c.retiredAt && !c.retiredBy && !c.retirementReason,
        "운영 중 인증Set의 종료 정보",
      );
    validateCatalogStructure(s, "courses", c);
  }
  for (const q of s.qualifications) {
    check(
      q.courseIds.every((id) =>
        s.courses.some(
          (c) => c.id === id && c.lv1OrganizationId === q.lv1OrganizationId,
        ),
      ),
      "인증Set 참조 누락",
    );
    validateCatalogStructure(s, "qualifications", q);
  }
  for (const a of s.assignments) {
    const q = s.qualifications.find((q) => q.id === a.qualificationId);
    check(
      q && q.lv1OrganizationId === a.lv1OrganizationId,
      "배정된 자격 버전·Lv1",
    );
    check(
      a.organizationPath[0]?.id === a.lv1OrganizationId,
      "배정 당시 조직 경로",
    );
    if (organizations)
      check(
        rootOf(a.learnerId) === a.lv1OrganizationId,
        "배정 사용자 Lv1 불일치",
      );
    // Identity is permanent; current roles are enforced by mutation authorization.
    // Reset must preserve assignments/roles even after a completed user's role changed.
    check(
      s.users.some((u) => u.id === a.learnerId),
      "학습자 참조",
    );
    check(
      s.users.some((u) => u.id === a.ownerAdminId),
      "담당 운영자 참조",
    );
    const es = s.enrollments.filter((e) => e.assignmentId === a.id);
    check(
      es.length === q.courseIds.length &&
        new Set(es.map((e) => e.courseId)).size === es.length &&
        es.every((e) => q.courseIds.includes(e.courseId)),
      "배정 필수 인증Set 집합",
    );
  }
  const activeKeys = new Set<string>(),
    rounds = new Set<string>();
  for (const t of s.attempts) {
    const e = s.enrollments.find((e) => e.id === t.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === t.courseId);
    check(
      e &&
        a &&
        c &&
        e.courseId === c.id &&
        a.learnerId === t.learnerId &&
        requiredKinds(c).includes(t.kind),
      "응시의 수강·직원·기준 연결",
    );
    const questions = assessmentQuestions(c, t.kind);
    const key = `${e.id}:${t.kind}`,
      roundKey = `${key}:${t.round}`;
    check(!rounds.has(roundKey), "응시 회차 중복");
    rounds.add(roundKey);
    check(
      Object.entries(t.answers).every(([id, value]) =>
        questions.some((q) => q.id === id && value < q.choices.length),
      ),
      "답안 항목/선택지",
    );
    if (t.status !== "graded") {
      check(
        !t.result && !t.date && !activeKeys.has(key),
        "진행 중 응시 중복/결과",
      );
      activeKeys.add(key);
      check(
        !s.attempts.some(
          (other) =>
            other.enrollmentId === e.id &&
            other.kind === t.kind &&
            other.result === "passed",
        ),
        "통과 후 추가 응시",
      );
    } else {
      check(t.date && t.result, "확정 응시 결과 누락");
      {
        const total = questions.reduce((v, q) => v + q.points, 0),
          earned = questions.reduce(
            (v, q) => v + (t.answers[q.id] === q.correct ? q.points : 0),
            0,
          );
        check(
          questions.every((q) => t.answers[q.id] !== undefined) &&
            t.total === total &&
            t.earned === earned &&
            t.result ===
              (earned * 100 >= total * assessmentPassScore(c, t.kind)!
                ? "passed"
                : "failed"),
          "객관식 채점 결과",
        );
        check(
          t.itemResults?.length === questions.length &&
            questions.every((q) =>
              t.itemResults?.some(
                (r) =>
                  r.itemId === q.id &&
                  r.possible === q.points &&
                  r.correct === (t.answers[q.id] === q.correct) &&
                  r.earned === (t.answers[q.id] === q.correct ? q.points : 0),
              ),
            ),
          "문항별 채점 결과",
        );
      }
    }
  }
  for (const e of s.enrollments) {
    const a = s.assignments.find((a) => a.id === e.assignmentId),
      c = s.courses.find((c) => c.id === e.courseId);
    check(a && c, "수강 참조");
    const completions = s.completions.filter((x) => x.enrollmentId === e.id),
      kinds = requiredKinds(c);
    check(completions.length <= 1, "수료 중복");
    for (const kind of kinds)
      check(
        s.attempts.filter(
          (t) =>
            t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
        ).length <= 1,
        "평가별 합격 중복",
      );
    if (
      c.qualificationType === "auditee" &&
      kinds.length > 0 &&
      !a.excludedReason &&
      kinds.every((kind) =>
        s.attempts.some(
          (t) =>
            t.enrollmentId === e.id && t.kind === kind && t.result === "passed",
        ),
      )
    )
      check(completions.length === 1, "수료 누락");
  }
  check(
    new Set(s.learningChecklists.map((v) => v.enrollmentId)).size ===
      s.learningChecklists.length,
    "학습 확인 중복",
  );
  for (const checklist of s.learningChecklists) {
    const e = s.enrollments.find((e) => e.id === checklist.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === e?.courseId);
    check(e && a && c?.qualificationType === "auditor", "학습 확인 배정 참조");
    check(
      new Set(checklist.items.map((i) => i.itemId)).size ===
        checklist.items.length,
      "학습 확인 항목 중복",
    );
    for (const item of checklist.items) {
      const original = c.learningItems.find((i) => i.id === item.itemId);
      check(
        original &&
          item.title === original.title &&
          item.type === original.type &&
          item.required === original.required &&
          item.confirmedBy === a.learnerId,
        "학습 확인 원본과 본인 근거",
      );
    }
    const required = c.learningItems.filter((i) => i.required);
    if (
      required.length &&
      required.every((i) => checklist.items.some((v) => v.itemId === i.id))
    )
      check(
        s.completions.some((v) => v.enrollmentId === e.id),
        "학습 확인 수료 누락",
      );
  }
  for (const co of s.completions) {
    const e = s.enrollments.find((e) => e.id === co.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId),
      c = s.courses.find((c) => c.id === co.courseId);
    check(
      e && a && c && co.learnerId === a.learnerId && co.courseId === e.courseId,
      "수료 참조",
    );
    if (co.method === "self_confirmation") {
      const checklist = s.learningChecklists.find(
        (v) => v.enrollmentId === e.id,
      );
      const required = c.learningItems.filter((i) => i.required);
      check(
        c.qualificationType === "auditor" &&
          co.evidence.length === 0 &&
          required.length > 0 &&
          required.every((i) =>
            co.learningEvidence.some((v) => v.itemId === i.id),
          ),
        "학습 확인 수료 근거",
      );
      check(
        checklist &&
          JSON.stringify(checklist.items) ===
            JSON.stringify(co.learningEvidence),
        "수료 확인 기록 잠금",
      );
      continue;
    }
    check(
      c.qualificationType === "auditee" && co.learningEvidence.length === 0,
      "평가 수료 유형 근거",
    );
    const kinds = requiredKinds(c);
    check(
      co.evidence.length === kinds.length &&
        new Set(co.evidence.map((x) => x.kind)).size === kinds.length &&
        co.evidence.every(
          (ev) =>
            kinds.includes(ev.kind) &&
            s.attempts.some(
              (t) =>
                t.id === ev.attemptId &&
                t.enrollmentId === e.id &&
                t.courseId === c.id &&
                t.learnerId === a.learnerId &&
                t.kind === ev.kind &&
                t.result === "passed",
            ),
        ),
      "수료 합격 근거",
    );
  }
  for (const a of s.assignments) {
    const certs = s.certifications.filter((x) => x.assignmentId === a.id),
      es = s.enrollments.filter((e) => e.assignmentId === a.id);
    check(certs.length <= 1, "인증 중복");
    if (
      !a.excludedReason &&
      es.length &&
      es.every((e) => s.completions.some((c) => c.enrollmentId === e.id))
    )
      check(
        !!a.renewalBatchId ||
          certs.length === 1 ||
          (a.auditor?.level === "main" &&
            a.auditor.kind === "initial" &&
            a.auditor.pendingGeneralCertification),
        "인증 누락",
      );
  }
  for (const cert of s.certifications) {
    const a = s.assignments.find((a) => a.id === cert.assignmentId),
      es = s.enrollments.filter((e) => e.assignmentId === a?.id);
    check(
      a &&
        cert.learnerId === a.learnerId &&
        cert.qualificationId === a.qualificationId &&
        cert.evidence.length === es.length &&
        new Set(cert.evidence.map((x) => x.enrollmentId)).size === es.length &&
        cert.evidence.every(
          (ev) =>
            es.some((e) => e.id === ev.enrollmentId) &&
            s.completions.some(
              (c) =>
                c.id === ev.completionId && c.enrollmentId === ev.enrollmentId,
            ),
        ),
      "인증 수료 근거",
    );
  }
  // Historical schema-13 compatibility only; comparison workflows are retired.
  for (const comp of s.comparisons) {
    const e = s.enrollments.find((e) => e.id === comp.enrollmentId),
      a = s.assignments.find((a) => a.id === e?.assignmentId);
    check(
      e &&
        a &&
        comp.courseId === e.courseId &&
        comp.learnerId === a.learnerId &&
        s.users.some((u) => u.id === comp.ownerAdminId),
      "비교 기록 참조",
    );
    check(
      comp.attemptIds.every((id) =>
        s.attempts.some(
          (t) =>
            t.id === id && t.enrollmentId === e.id && t.status === "graded",
        ),
      ),
      "비교 응시 참조",
    );
    const selected = comp.attemptIds.map((id) =>
      s.attempts.find((t) => t.id === id)!,
    );
    check(
      new Set(selected.map((t) => t.kind)).size === selected.length,
      "비교 평가 종류 중복",
    );
    if (comp.status === "final") {
      const course = s.courses.find((c) => c.id === comp.courseId)!;
      check(
        requiredKinds(course).every((kind) =>
          selected.some((t) => t.kind === kind),
        ) &&
          comp.finalizedAt &&
          comp.observedAt &&
          comp.observer.trim() &&
          comp.task.trim() &&
          comp.criterion.trim() &&
          comp.evidence.trim(),
        "확정 비교 기록 누락",
      );
      const passed = selected.every((t) => t.result === "passed");
      const outcome =
        comp.independence !== "independent" || comp.performance === "unknown"
          ? "pending"
          : passed
            ? comp.performance === "met"
              ? "both_met"
              : "assessment_only"
            : comp.performance === "met"
              ? "performance_only"
              : "neither_met";
      check(comp.outcome === outcome, "비교 판정 불일치");
    } else check(!comp.finalizedAt && !comp.outcome, "초안 비교 판정");
    if (comp.supersedesId)
      check(
        s.comparisons.some(
          (c) =>
            c.id !== comp.id &&
            c.id === comp.supersedesId &&
            c.enrollmentId === e.id &&
            c.status === "final" &&
            c.createdAt <= comp.createdAt,
        ),
        "정정 원본 참조",
      );
  }
  check(
    s.audits.every((ev) => s.users.some((u) => u.id === ev.actorId)),
    "변경 주체 참조",
  );
  check(
    new Set(s.requests.map((r) => `${r.actorId}:${r.key}`)).size ===
      s.requests.length,
    "요청 식별자 중복",
  );
  validateWorkflow(s, legacy);
  return s;
}

export const validateLegacyState = (
  input: unknown,
  organizations?: OrganizationDocument,
) => validateState(input, organizations, true);
