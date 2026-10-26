import { numberedQualificationVersion } from "./qualification-templates.ts";
import { currentTeamQualifications } from "@eks/contracts";
import {
  organizationEntries,
  effectiveCredentialStatus,
  credentialCurrent,
  latestPeriod,
  renewalPhase,
  renewalOpensOn,
  kstDate,
  qualificationUseErrors,
  type State,
  type OrganizationDocument,
  type UserView,
  type Qualification,
  type Certification,
  type StoredAssignment,
  type DashboardQuery,
  type DashboardScope,
  type DashboardSnapshot,
  type DashboardPerson,
  type DashboardQualificationCell,
  type DashboardQualificationOption,
  type DashboardMemberRow,
  type DashboardSummary,
  type DashboardPage,
  type DashboardOptions,
  type DashboardResponse,
  type DashboardDetailRow,
  type DashboardDetails,
  type DashboardMetric,
  type DashboardOrganizationRow,
  type DashboardQualificationRow,
  type DashboardRenewalRow,
  type DashboardMemberDetail,
  type DashboardCourseSummary,
  type DashboardExpiryBucket,
  type DashboardRenewalState,
  type DashboardChartSelection,
  type DashboardChartDetails,
} from "@eks/contracts";
import { demand, DomainError } from "./errors.ts";
import { dashboardCharts } from "./dashboard-charts.ts";
import { currentQualification } from "./qualification-templates.ts";

const pairKey = (userId: string, entityId: string) =>
  `${userId}\u0000${entityId}`;
const group = <T>(rows: T[], key: (row: T) => string) => {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row),
      list = result.get(id);
    if (list) list.push(row);
    else result.set(id, [row]);
  }
  return result;
};
const activeProgress = (c: DashboardQualificationCell) =>
  !["none", "unplanned"].includes(c.progress);
const days = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
const textCompare = (a: string, b: string) => a.localeCompare(b, "ko");

/** Scope is determined exclusively by the authenticated actor, never by client visibility. */
export function dashboardScope(
  doc: OrganizationDocument,
  user: UserView,
  query: DashboardQuery,
): DashboardScope {
  const entries = organizationEntries(doc),
    byId = new Map(entries.map((e) => [e.id, e]));
  const operator = user.roles.includes("system_operator");
  const fullManager = operator || user.roles.includes("admin");
  const directOnly = !fullManager;
  demand(
    fullManager ||
      (user.roles.includes("organization_admin") &&
        user.organizationAdministration?.organizationId ===
          user.organizationId),
    403,
    "자격 인증 현황 조회 권한이 없습니다.",
    "DASHBOARD_FORBIDDEN",
  );
  demand(
    !operator || query.lv1OrganizationId,
    403,
    "관리할 Lv1 조직을 먼저 선택해 주세요.",
    "MANAGEMENT_SCOPE_REQUIRED",
  );
  const lv1 = query.lv1OrganizationId || user.lv1OrganizationId;
  demand(
    operator || lv1 === user.lv1OrganizationId,
    403,
    "다른 팀의 현황은 조회할 수 없습니다.",
    "DASHBOARD_FORBIDDEN",
  );
  demand(byId.get(lv1)?.level === 1, 422, "Lv1 조직을 선택해 주세요.");
  const id = query.organizationId || (directOnly ? user.organizationId : lv1),
    org = byId.get(id);
  demand(
    org && org.lv1OrganizationId === lv1,
    403,
    "조회할 수 없는 조직입니다.",
    "DASHBOARD_FORBIDDEN",
  );
  demand(
    !directOnly || id === user.organizationId,
    403,
    "직접 소속된 조직만 조회할 수 있습니다.",
    "DASHBOARD_FORBIDDEN",
  );
  demand(
    !directOnly || query.includeDescendants !== true,
    403,
    "세부 조직 관리자는 직접 소속 인원만 조회할 수 있습니다.",
    "DASHBOARD_FORBIDDEN",
  );
  return {
    lv1OrganizationId: lv1,
    organizationId: id,
    organizationName: org.name,
    organizationPath: org.path,
    includeDescendants: directOnly ? false : query.includeDescendants !== false,
    directOnly,
    fullManager,
  };
}

/** One in-memory read index per request. All projections below are pure and contain safe fields only. */
export function dashboardReader(
  s: State,
  doc: OrganizationDocument,
  user: UserView,
  query: DashboardQuery,
  at: string,
) {
  const type = query.qualificationType || "auditee";
  const scope = dashboardScope(doc, user, query),
    date = kstDate(at);
  const entries = organizationEntries(doc),
    orgs = new Map(entries.map((e) => [e.id, e]));
  const includesOrg = (id: string) =>
    id === scope.organizationId ||
    (scope.includeDescendants &&
      !!orgs.get(id)?.path.some((p) => p.id === scope.organizationId));
  const allowedUsers = s.users.filter(
    (u) =>
      u.roles.includes(type === "auditor" ? "evaluator" : "learner") &&
      includesOrg(u.organizationId),
  );
  const people = allowedUsers.map((u): DashboardPerson => {
    const org = orgs.get(u.organizationId)!;
    return {
      userId: u.id,
      name: u.name,
      organizationId: u.organizationId,
      organizationName: org.name,
      organizationPath: org.path,
      held: u.certificationEligibility === "hold",
      inactive: !org.effectiveActive,
      eligible: u.certificationEligibility !== "hold" && org.effectiveActive,
    };
  });
  const personById = new Map(people.map((p) => [p.userId, p]));
  const qualifications = new Map(s.qualifications.map((q) => [q.id, q]));
  const templates = new Map(s.qualificationTemplates.map((t) => [t.id, t]));
  const courses = new Map(s.courses.map((c) => [c.id, c]));
  const pool = new Map(
    currentTeamQualifications(s)
      .filter(
        (p) =>
          p.lv1OrganizationId === scope.lv1OrganizationId &&
          qualifications.get(p.qualificationId)?.qualificationType === type,
      )
      .map((p) => [p.entityId, p]),
  );
  const title = (q: Qualification) =>
    templates.get(q.templateId)?.title || q.title;
  const entityOf = (qid: string) => qualifications.get(qid)?.entityId || "";
  const assignments = s.assignments.filter(
    (a) =>
      qualifications.get(a.qualificationId)?.qualificationType === type &&
      a.lv1OrganizationId === scope.lv1OrganizationId &&
      personById.has(a.learnerId),
  );
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const assignmentsByPair = group(assignments, (a) =>
    pairKey(a.learnerId, entityOf(a.qualificationId)),
  );
  const certsByAssignment = new Map(
    s.certifications
      .filter((c) => assignmentById.has(c.assignmentId))
      .map((c) => [c.assignmentId, c]),
  );
  const certs = [...certsByAssignment.values()];
  const revocationEvents = new Map(
    s.lifecycleEvents
      .filter(
        (e) =>
          e.subject === "certification" &&
          (e.action === "expired" ||
            (e.action === "status.changed" &&
              typeof e.after === "object" &&
              e.after !== null &&
              !Array.isArray(e.after) &&
              e.after.status === "Revoke")),
      )
      .map((e) => [e.targetId, e]),
  );
  const allPlans = s.plans.filter(
    (p) =>
      !p.deletedAt &&
      qualifications.get(p.qualificationId)?.qualificationType === type &&
      p.lv1OrganizationId === scope.lv1OrganizationId &&
      personById.has(p.learnerId),
  );
  const plans = allPlans.filter(
    (p) =>
      p.status !== "draft" ||
      !s.planningRequests.find((r) => r.id === p.requestId)?.closed,
  );
  const plansByPair = group(plans, (p) =>
    pairKey(p.learnerId, entityOf(p.qualificationId)),
  );
  const planById = new Map(plans.map((p) => [p.id, p]));
  const requestById = new Map(s.planningRequests.map((r) => [r.id, r]));
  const requests = s.planningRequests.filter(
    (r) =>
      r.qualificationType === type &&
      personById.has(r.learnerId) &&
      r.lv1OrganizationId === scope.lv1OrganizationId &&
      r.organizationId === personById.get(r.learnerId)!.organizationId,
  );
  const requestsByUser = group(requests, (r) => r.learnerId);
  const selectedPairs = new Set(
    requests
      .filter((r) => !r.completion && !r.closed)
      .flatMap((r) =>
        r.selections.map((t) => pairKey(r.learnerId, t.entityId)),
      ),
  );
  const enrollments = s.enrollments.filter((e) =>
    assignmentById.has(e.assignmentId),
  );
  const enrollmentsByAssignment = group(enrollments, (e) => e.assignmentId);
  const enrollmentIds = new Set(enrollments.map((e) => e.id));
  const attemptsByEnrollment = group(
    s.attempts.filter((t) => enrollmentIds.has(t.enrollmentId)),
    (t) => t.enrollmentId,
  );
  const completionsByEnrollment = new Map(
    s.completions
      .filter((c) => enrollmentIds.has(c.enrollmentId))
      .map((c) => [c.enrollmentId, c]),
  );
  const renewalByPeriod = new Map(
    s.renewals
      .filter((r) => r.status === "draft")
      .map((r) => [`${r.certificationId}:${r.periodId}`, r]),
  );
  const recordEntities = new Set([
    ...assignments
      .filter((a) => !a.excludedReason)
      .map((a) => entityOf(a.qualificationId)),
    ...plans
      .filter(
        (p) =>
          p.organizationId === personById.get(p.learnerId)?.organizationId &&
          p.status === "draft",
      )
      .map((p) => entityOf(p.qualificationId)),
  ]);
  const entityQualifications = new Map<string, Qualification>();
  for (const q of s.qualifications)
    if (
      q.qualificationType === type &&
      q.lv1OrganizationId === scope.lv1OrganizationId &&
      (pool.has(q.entityId) || recordEntities.has(q.entityId))
    ) {
      const old = entityQualifications.get(q.entityId);
      if (!old || (q.version ?? 0) > (old.version ?? 0))
        entityQualifications.set(q.entityId, q);
    }
  for (const p of pool.values()) {
    const q = qualifications.get(p.qualificationId);
    if (q?.qualificationType === type) entityQualifications.set(p.entityId, q);
  }
  const allOptions: DashboardQualificationOption[] = [...entityQualifications]
    .map(([entityId, q]) => ({
      entityId,
      title: title(q),
      registered: pool.has(entityId),
      hasRecords: recordEntities.has(entityId),
      ...(pool.has(entityId)
        ? {
            currentQualificationId: pool.get(entityId)!.qualificationId,
            currentVersion: qualifications.get(
              pool.get(entityId)!.qualificationId,
            )?.version,
            criterionStatus:
              qualifications.get(pool.get(entityId)!.qualificationId)
                ?.lifecycleStatus || "Active",
          }
        : {}),
    }))
    .sort(
      (a, b) =>
        textCompare(a.title, b.title) || textCompare(a.entityId, b.entityId),
    );
  const optionById = new Map(allOptions.map((o) => [o.entityId, o]));
  if (query.entityId)
    demand(
      optionById.has(query.entityId),
      403,
      "조회할 수 없는 팀 자격입니다.",
      "DASHBOARD_FORBIDDEN",
    );
  const selectedOptions = allOptions.filter(
    (o) =>
      (!query.entityId || o.entityId === query.entityId) &&
      (query.qualificationScope !== "registered" || o.registered) &&
      (query.qualificationScope !== "records" || o.hasRecords),
  );
  const unusable = new Set<string>();
  for (const [entityId, p] of pool) {
    const q = qualifications.get(p.qualificationId);
    if (
      !q ||
      qualificationUseErrors(
        currentQualification(s, q),
        q.courseIds.flatMap((id) => courses.get(id) || []),
      ).length
    )
      unusable.add(entityId);
  }
  const snapshot: DashboardSnapshot = {
    asOf: at,
    date,
    stateRevision: s.revision,
    organizationRevision: doc.revision,
    scope,
    exclusions: {
      totalPeople: people.length,
      eligiblePeople: people.filter((p) => p.eligible).length,
      excludedPeople: people.filter((p) => !p.eligible).length,
      heldPeople: people.filter((p) => p.held).length,
      inactivePeople: people.filter((p) => p.inactive).length,
      heldAndInactivePeople: people.filter((p) => p.held && p.inactive).length,
    },
  };

  function stale() {
    if (
      (query.expectedStateRevision !== undefined &&
        query.expectedStateRevision !== s.revision) ||
      (query.expectedOrganizationRevision !== undefined &&
        query.expectedOrganizationRevision !== doc.revision) ||
      (query.expectedDate !== undefined && query.expectedDate !== date)
    )
      throw new DomainError(
        409,
        "현황이 변경되었습니다. 대시보드를 새로 조회해 주세요.",
        "DASHBOARD_STALE",
      );
  }
  function expiry(c: Certification): DashboardExpiryBucket {
    const current = credentialCurrent(c),
      status = effectiveCredentialStatus(c, at);
    if (status === "Revoke") {
      const event = revocationEvents.get(c.id);
      if (event?.action === "status.changed") return "revoked";
      return current.validity?.type === "months" &&
        current.expiresOn &&
        current.expiresOn < date
        ? "expired"
        : "revoked";
    }
    if (current.validity?.type === "unlimited") return "unlimited";
    if (!current.expiresOn || current.validity?.type !== "months")
      return "unknown";
    const d = days(date, current.expiresOn);
    return d <= 30 ? "0_30" : d <= 60 ? "31_60" : d <= 90 ? "61_90" : "over_90";
  }
  function renewal(
    person: DashboardPerson,
    entityId: string,
    c?: Certification,
  ) {
    const codes: string[] = [];
    if (!c || type === "auditor")
      return {
        renewalState: "not_applicable" as DashboardRenewalState,
        renewalBlockCodes: codes,
      };
    const p = latestPeriod(c),
      current = credentialCurrent(c);
    if (current.validity?.type === "unlimited")
      return {
        renewalState: "not_applicable" as DashboardRenewalState,
        renewalBlockCodes: codes,
      };
    if (person.held) codes.push("TARGET_HOLD");
    if (person.inactive) codes.push("ORGANIZATION_INACTIVE");
    if (effectiveCredentialStatus(c, at) !== "Active")
      codes.push("CREDENTIAL_NOT_ACTIVE");
    if (!p || p.validity.type !== "months") codes.push("VALIDITY_UNKNOWN");
    if (
      !pool.has(entityId) ||
      qualifications.get(pool.get(entityId)!.qualificationId)?.deletedAt
    )
      codes.push("NOT_REGISTERED");
    else if (unusable.has(entityId)) codes.push("CRITERIA_UNAVAILABLE");
    const phase = renewalPhase(c, at),
      opensOn = p && renewalOpensOn(p);
    const state: DashboardRenewalState = codes.length
      ? "blocked"
      : renewalByPeriod.has(`${c.id}:${p?.id}`)
        ? "in_progress"
        : phase?.state === "open"
          ? "available"
          : phase?.state === "upcoming"
            ? "upcoming"
            : "scheduled";
    return {
      renewalState: state,
      renewalBlockCodes: codes,
      ...(opensOn ? { renewalOpensOn: opensOn } : {}),
    };
  }
  const cellCache = new Map<string, DashboardQualificationCell>();
  function cell(
    person: DashboardPerson,
    option: DashboardQualificationOption,
  ): DashboardQualificationCell {
    const key = pairKey(person.userId, option.entityId),
      cached = cellCache.get(key);
    if (cached) return cached;
    const history = assignmentsByPair.get(key) || [];
    const validHistory = history.filter((a) => !a.excludedReason);
    const credentials = validHistory
      .flatMap((a) => certsByAssignment.get(a.id) || [])
      .sort((a, b) => b.date.localeCompare(a.date));
    const cert =
      credentials.find((c) => effectiveCredentialStatus(c, at) === "Active") ||
      credentials.find((c) => effectiveCredentialStatus(c, at) === "Hold") ||
      credentials[0];
    // Confirmed assignments survive a same-team move; only old-organization requests and drafts stop driving current work.
    const currentAssignments = validHistory
      .filter((a) => !a.acquisitionClosedAt && !certsByAssignment.has(a.id))
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
    const assignment = currentAssignments[0];
    const revoked = credentials.find(
      (c) => effectiveCredentialStatus(c, at) === "Revoke",
    );
    const currentPlans = (plansByPair.get(key) || [])
      .filter(
        (p) =>
          p.organizationId === person.organizationId &&
          (p.assignmentId
            ? currentAssignments.some((a) => a.id === p.assignmentId)
            : p.status === "draft" &&
              p.previousCertificationId === revoked?.id),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const plan =
      (assignment?.planId && planById.get(assignment.planId)) ||
      currentPlans[0];
    const evidenceAssignmentId = assignment?.id || cert?.assignmentId;
    const ens = evidenceAssignmentId
      ? enrollmentsByAssignment.get(evidenceAssignmentId) || []
      : [];
    const completedCourses = ens.filter((e) =>
      completionsByEnrollment.has(e.id),
    ).length;
    const hasChecks = ens.some((e) =>
      s.learningChecklists.some(
        (c) => c.enrollmentId === e.id && c.items.length,
      ),
    );
    const hasAttempt = ens.some(
      (e) => (attemptsByEnrollment.get(e.id)?.length || 0) > 0,
    );
    const progress = assignment
      ? completedCourses > 0
        ? "partial_completion"
        : type === "auditor"
          ? hasChecks
            ? "learning_progress"
            : "learning_wait"
          : hasAttempt
            ? "assessment_progress"
            : "assessment_wait"
      : plan?.status === "draft"
        ? "draft"
        : selectedPairs.has(key) &&
            !["Active", "Hold"].includes(
              cert ? effectiveCredentialStatus(cert, at) : "",
            )
          ? "unplanned"
          : "none";
    const record =
      assignment || plan || (cert && assignmentById.get(cert.assignmentId));
    const q = record && qualifications.get(record.qualificationId);
    const acquisitionBlockCodes: string[] = [];
    const acquisitionNeeded =
      (!cert || effectiveCredentialStatus(cert, at) !== "Active") &&
      (selectedPairs.has(key) || !!assignment || !!plan);
    if (acquisitionNeeded) {
      if (person.held) acquisitionBlockCodes.push("TARGET_HOLD");
      if (!assignment) {
        if (person.inactive)
          acquisitionBlockCodes.push("ORGANIZATION_INACTIVE");
        if (cert && effectiveCredentialStatus(cert, at) === "Hold")
          acquisitionBlockCodes.push("CREDENTIAL_HOLD");
        const registered = pool.get(option.entityId);
        if (
          !registered ||
          qualifications.get(registered.qualificationId)?.deletedAt
        )
          acquisitionBlockCodes.push("NOT_REGISTERED");
        else if (unusable.has(option.entityId))
          acquisitionBlockCodes.push("CRITERIA_UNAVAILABLE");
        if (
          plan?.status === "draft" &&
          registered &&
          plan.qualificationId !== registered.qualificationId
        )
          acquisitionBlockCodes.push("DRAFT_VERSION_CHANGED");
        const requestAvailable = (requestsByUser.get(person.userId) || []).some(
          (r) => {
            if (r.completion || r.closed) return false;
            const target = r.selections.find(
              (t) => t.entityId === option.entityId,
            );
            return (
              (r.mode === "learner_choice" || !!target) &&
              (!target || target.previousCertificationId === revoked?.id)
            );
          },
        );
        if (!requestAvailable) acquisitionBlockCodes.push("REQUEST_REQUIRED");
      }
    }
    const item: DashboardQualificationCell = {
      entityId: option.entityId,
      title: option.title,
      registered: option.registered,
      ...(option.currentVersion
        ? { currentVersion: option.currentVersion }
        : {}),
      efficacy: cert ? effectiveCredentialStatus(cert, at) : "none",
      progress,
      selected: selectedPairs.has(key) || !!assignment || !!plan || !!cert,
      ...(assignment
        ? { assignmentId: assignment.id }
        : cert
          ? { assignmentId: cert.assignmentId }
          : {}),
      ...(plan
        ? {
            planId: plan.id,
            ...(plan.targetOn ? { targetOn: plan.targetOn } : {}),
          }
        : {}),
      ...(q
        ? {
            recordQualificationId: q.id,
            recordTitle: record?.qualificationMetadata?.title || q.title,
            recordVersion: numberedQualificationVersion(q),
          }
        : {}),
      ...(cert
        ? {
            certificationId: cert.id,
            issuedOn: kstDate(cert.date),
            expiresOn: credentialCurrent(cert).expiresOn,
            expiryBucket: expiry(cert),
          }
        : {}),
      ...renewal(person, option.entityId, cert),
      acquisitionBlockCodes,
      completedCourses,
      totalCourses: evidenceAssignmentId
        ? ens.length
        : q?.courseIds.length || 0,
    };
    cellCache.set(key, item);
    return item;
  }
  const search = (query.search || "").trim().toLocaleLowerCase();
  const matchesPersonText = (p: DashboardPerson) =>
    !search ||
    `${p.name} ${p.organizationPath.map((o) => o.name).join(" ")}`
      .toLocaleLowerCase()
      .includes(search);
  const matchesCell = (c: DashboardQualificationCell, p: DashboardPerson) =>
    (!search ||
      matchesPersonText(p) ||
      c.title.toLocaleLowerCase().includes(search)) &&
    (!query.efficacy || query.efficacy === c.efficacy) &&
    (!query.progress || query.progress === c.progress) &&
    (!query.expiryBucket || query.expiryBucket === c.expiryBucket) &&
    (!query.renewalState || query.renewalState === c.renewalState);
  const hasCellFilter = !!(
    query.entityId ||
    query.efficacy ||
    query.progress ||
    query.expiryBucket ||
    query.renewalState
  );
  const memberCache = new Map<string, DashboardMemberRow>();
  function memberRow(p: DashboardPerson): DashboardMemberRow {
    const old = memberCache.get(p.userId);
    if (old) return old;
    const cells = selectedOptions
      .map((o) => cell(p, o))
      .filter((c) => matchesCell(c, p));
    const reqs = (requestsByUser.get(p.userId) || []).filter(
      (r) =>
        !r.completion &&
        !r.closed &&
        (!query.entityId ||
          r.selections.some((t) => t.entityId === query.entityId)),
    );
    const upcoming: NonNullable<DashboardMemberRow["nextSchedule"]>[] =
      reqs.map((r) => ({
        kind: "request",
        date: r.dueOn,
        title: "계획 수립 요청",
      }));
    for (const c of cells.filter(activeProgress)) {
      if (c.targetOn)
        upcoming.push({
          kind: "target",
          date: c.targetOn,
          title: c.title,
          entityId: c.entityId,
        });
      const assignment = c.assignmentId && assignmentById.get(c.assignmentId);
      const plan =
        assignment && assignment.planId && planById.get(assignment.planId);
      if (!assignment || !plan) continue;
      const schedules = new Map(
        plan.schedules.map((schedule) => [schedule.courseId, schedule]),
      );
      for (const e of enrollmentsByAssignment.get(assignment.id) || []) {
        const assessmentOn = schedules.get(e.courseId)?.assessmentOn;
        if (assessmentOn && !completionsByEnrollment.has(e.id))
          upcoming.push({
            kind: "assessment",
            date: assessmentOn,
            title: c.title,
            entityId: c.entityId,
            courseTitle: courses.get(e.courseId)?.title,
          });
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    const row: DashboardMemberRow = {
      ...p,
      activeQualifications: cells.filter((c) => c.efficacy === "Active").length,
      inProgress: cells.filter(activeProgress).length,
      incompleteRequests: reqs.length,
      overdueRequests: reqs.filter((r) => r.dueOn < date).length,
      ...(upcoming[0] ? { nextSchedule: upcoming[0] } : {}),
      cells,
    };
    memberCache.set(p.userId, row);
    return row;
  }
  const allMembers = people
    .map(memberRow)
    .filter(
      (p) =>
        (!hasCellFilter || p.cells.length > 0) &&
        (!search || matchesPersonText(p) || p.cells.length > 0),
    );
  const metricMembers = allMembers.filter((p) => p.eligible);
  const metricIds = new Set(metricMembers.map((p) => p.userId));
  const visibleMembers = allMembers.filter(
    (p) =>
      query.population === "all" ||
      (query.population === "excluded" ? !p.eligible : p.eligible),
  );
  const relevantRequests = requests.filter(
    (r) =>
      metricIds.has(r.learnerId) &&
      !r.completion &&
      !r.closed &&
      (!query.entityId ||
        r.selections.some((t) => t.entityId === query.entityId)),
  );
  const latestCertIds = new Set(
    allMembers.flatMap((p) => p.cells.flatMap((c) => c.certificationId || [])),
  );
  const allRenewals = certs
    .filter(
      (c) =>
        latestCertIds.has(c.id) &&
        !assignmentById.get(c.assignmentId)?.excludedReason,
    )
    .map((c): DashboardRenewalRow => {
      const p = personById.get(c.learnerId)!,
        a = assignmentById.get(c.assignmentId)!,
        q = qualifications.get(c.qualificationId)!,
        o = optionById.get(q.entityId)!,
        current = credentialCurrent(c),
        efficacy = effectiveCredentialStatus(c, at);
      return {
        ...p,
        entityId: q.entityId,
        title: o.title,
        recordTitle:
          c.qualificationMetadata?.title || c.snapshot?.title || q.title,
        recordVersion: numberedQualificationVersion(q),
        certificationId: c.id,
        assignmentId: a.id,
        efficacy,
        issuedOn: kstDate(c.date),
        ...(current.expiresOn
          ? {
              expiresOn: current.expiresOn,
              daysUntilExpiry: days(date, current.expiresOn),
            }
          : {}),
        expiryBucket: expiry(c),
        ...renewal(p, q.entityId, c),
      };
    });
  const metricRenewals = allRenewals.filter((r) => metricIds.has(r.userId));
  const overdueTargets = metricMembers.flatMap((p) =>
    p.cells
      .filter((c) => activeProgress(c) && c.targetOn && c.targetOn < date)
      .map((c) => ({ p, c })),
  );
  const overdueAssessments = metricMembers.flatMap((p) =>
    p.cells
      .filter((c) => activeProgress(c) && c.assignmentId)
      .flatMap((c) => {
        const a = assignmentById.get(c.assignmentId!)!,
          plan = a.planId ? planById.get(a.planId) : undefined;
        if (!plan) return [];
        const schedules = new Map(
          plan.schedules.map((schedule) => [schedule.courseId, schedule]),
        );
        return (enrollmentsByAssignment.get(a.id) || [])
          .filter(
            (e) =>
              !completionsByEnrollment.has(e.id) &&
              !!schedules.get(e.courseId)?.assessmentOn &&
              schedules.get(e.courseId)!.assessmentOn < date,
          )
          .map((e) => ({
            p,
            c,
            e,
            dueOn: schedules.get(e.courseId)!.assessmentOn,
          }));
      }),
  );
  const summary = summarize(metricMembers);
  function summarize(rows: DashboardMemberRow[]): DashboardSummary {
    const ids = new Set(rows.map((p) => p.userId)),
      cells = rows.flatMap((p) => p.cells);
    const efficacy = { Active: 0, Hold: 0, Revoke: 0, none: 0 };
    const progress = {
      unplanned: 0,
      draft: 0,
      learning_wait: 0,
      learning_progress: 0,
      assessment_wait: 0,
      assessment_progress: 0,
      partial_completion: 0,
      none: 0,
    };
    for (const c of cells) {
      efficacy[c.efficacy]++;
      progress[c.progress]++;
    }
    return {
      eligiblePeople: rows.length,
      blockedProgress: cells.filter((c) => c.acquisitionBlockCodes.length > 0)
        .length,
      uniqueActiveHolders: rows.filter((p) => p.activeQualifications > 0)
        .length,
      inProgress: cells.filter(activeProgress).length,
      incompleteRequests: relevantRequests.filter((r) => ids.has(r.learnerId))
        .length,
      expires0to30: metricRenewals.filter(
        (r) => ids.has(r.userId) && r.expiryBucket === "0_30",
      ).length,
      overdueRequests: relevantRequests.filter(
        (r) => ids.has(r.learnerId) && r.dueOn < date,
      ).length,
      overdueTargets: overdueTargets.filter((r) => ids.has(r.p.userId)).length,
      overdueAssessments: overdueAssessments.filter((r) => ids.has(r.p.userId))
        .length,
      efficacy,
      progress,
    };
  }
  const sortRows = <T>(
    rows: T[],
    key: (row: T) => string | number,
    tie: (row: T) => string | string[],
  ) =>
    rows.slice().sort((a, b) => {
      const x = key(a),
        y = key(b),
        order =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : textCompare(String(x), String(y));
      if (order) return (query.order === "desc" ? -1 : 1) * order;
      const left = tie(a),
        right = tie(b),
        xs = Array.isArray(left) ? left : [left],
        ys = Array.isArray(right) ? right : [right];
      for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
        const result = textCompare(xs[i] || "", ys[i] || "");
        if (result) return result;
      }
      return 0;
    });
  const page = <T>(
    items: T[],
    size: number = query.pageSize || 25,
    current = query.page || 1,
  ): DashboardPage<T> => {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const safeCurrent = Math.min(current, pages);
    return {
      items: items.slice((safeCurrent - 1) * size, safeCurrent * size),
      page: safeCurrent,
      pageSize: size,
      total: items.length,
      pages,
    };
  };
  const personSort = (p: DashboardMemberRow) =>
    !query.sort || query.sort === "organization"
      ? p.organizationPath.map((o) => o.name).join("/")
      : query.sort === "targetOn"
        ? p.cells.flatMap((c) => c.targetOn || []).sort()[0] || "9999"
        : query.sort === "expiresOn"
          ? p.cells.flatMap((c) => c.expiresOn || []).sort()[0] || "9999"
          : p.name;
  const personTie = (p: DashboardMemberRow) =>
    !query.sort || query.sort === "organization"
      ? [p.name, p.userId]
      : [p.userId];
  function options(): DashboardOptions {
    return {
      snapshot,
      organizations: entries
        .filter(
          (e) =>
            e.lv1OrganizationId === scope.lv1OrganizationId &&
            (!scope.directOnly || e.id === scope.organizationId),
        )
        .map((e) => ({
          id: e.id,
          name: e.name,
          parentId: e.parentId,
          level: e.level,
          path: e.path,
          active: e.effectiveActive,
        })),
      qualifications: allOptions,
    };
  }
  let chartModel: ReturnType<typeof dashboardCharts>;
  function dashboard(): DashboardResponse {
    let fullOrganizations: DashboardOrganizationRow[] = [];
    let fullQualifications: DashboardQualificationRow[] = [];
    const view = query.view || "summary";
    const response: DashboardResponse = {
      snapshot,
      view,
      summary,
      charts: [],
      organizations: page([]),
      qualifications: page([]),
      members: page([]),
      renewals: page([]),
      matrix: {
        members: page([]),
        columns: page([], 10, query.columnPage || 1),
      },
    };
    if (view === "organizations" || view === "summary") {
      const groups = [
        { org: orgs.get(scope.organizationId)!, direct: true },
        ...(scope.includeDescendants
          ? entries
              .filter((e) => e.parentId === scope.organizationId)
              .map((org) => ({ org, direct: false }))
          : []),
      ];
      const rows = groups.map(({ org, direct }): DashboardOrganizationRow => {
        const belongs = (p: DashboardPerson) =>
          direct
            ? p.organizationId === org.id
            : p.organizationPath.some((x) => x.id === org.id);
        const own = metricMembers.filter(belongs),
          sum = summarize(own);
        return {
          organizationId: org.id,
          name: org.name,
          direct,
          people: sum.eligiblePeople,
          excludedPeople: allMembers.filter((p) => !p.eligible && belongs(p))
            .length,
          activeHolders: sum.uniqueActiveHolders,
          inProgress: sum.inProgress,
          expires0to30: sum.expires0to30,
          overdueRequests: sum.overdueRequests,
          overdueTargets: sum.overdueTargets,
          overdueAssessments: sum.overdueAssessments,
        };
      });
      fullOrganizations = sortRows(
        rows,
        (r) => r.name,
        (r) => r.organizationId,
      );
      response.organizations = page(fullOrganizations);
    }
    if (view === "qualifications" || view === "summary") {
      const byEntity = group(
        metricMembers.flatMap((p) => p.cells),
        (c) => c.entityId,
      );
      const rows = selectedOptions
        .filter(
          (o) =>
            view !== "qualifications" ||
            !search ||
            o.title.toLocaleLowerCase().includes(search),
        )
        .map((o): DashboardQualificationRow => {
          const cells = byEntity.get(o.entityId) || [];
          return {
            ...o,
            activePeople: cells.filter((c) => c.efficacy === "Active").length,
            heldPeople: cells.filter((c) => c.efficacy === "Hold").length,
            revokedPeople: cells.filter((c) => c.efficacy === "Revoke").length,
            inProgress: cells.filter(activeProgress).length,
            unplanned: cells.filter((c) => c.progress === "unplanned").length,
            expires0to30: cells.filter((c) => c.expiryBucket === "0_30").length,
          };
        });
      fullQualifications = sortRows(
        rows,
        (r) => r.title,
        (r) => r.entityId,
      );
      response.qualifications = page(fullQualifications);
    }
    if (view === "members") {
      response.members = page(sortRows(visibleMembers, personSort, personTie));
      response.members.items = response.members.items.map((p) => ({
        ...p,
        cells: p.cells
          .filter(
            (c) => c.progress !== "none" || c.renewalState === "in_progress",
          )
          .sort(
            (a, b) =>
              (a.targetOn || "9999").localeCompare(b.targetOn || "9999") ||
              textCompare(a.title, b.title),
          )
          .slice(0, 2),
      }));
    }
    if (view === "matrix") {
      const columns = page(selectedOptions, 10, query.columnPage || 1),
        ids = new Set(columns.items.map((c) => c.entityId));
      const members = page(sortRows(visibleMembers, personSort, personTie));
      members.items = members.items.map((p) => ({
        ...p,
        cells: p.cells.filter((c) => ids.has(c.entityId)),
      }));
      response.matrix = { members, columns };
    }
    if (view === "renewals") {
      const ids = new Set(visibleMembers.map((p) => p.userId));
      response.renewals = page(
        sortRows(
          allRenewals.filter((r) => ids.has(r.userId)),
          (r) =>
            query.sort === "name"
              ? r.name
              : query.sort === "qualification"
                ? r.title
                : r.expiresOn || "9999",
          (r) => r.certificationId,
        ),
      );
    }
    const chartMembers = ["members", "matrix", "renewals"].includes(view)
      ? visibleMembers
      : metricMembers;
    const chartIds = new Set(chartMembers.map((p) => p.userId));
    chartModel = dashboardCharts({
      view,
      scope,
      members: chartMembers,
      renewals: allRenewals.filter((r) => chartIds.has(r.userId)),
      organizations: fullOrganizations,
      qualifications: fullQualifications,
    });
    response.charts = chartModel.charts;
    return response;
  }
  function chartDetails(
    selection: DashboardChartSelection,
  ): DashboardChartDetails {
    stale();
    dashboard();
    const selected = chartModel.details(selection);
    const sorted = sortRows(
      selected.rows,
      (r) => r.expiresOn || r.organizationPath.map((o) => o.name).join("/"),
      (r) => [r.title || "", r.name, r.key],
    );
    return {
      snapshot,
      title: selected.title,
      unit: selected.unit,
      selection,
      rows: page(sorted),
    };
  }
  function details(metric: DashboardMetric): DashboardDetails {
    stale();
    let rows: DashboardDetailRow[] = [];
    const base = (p: DashboardPerson, key: string): DashboardDetailRow => ({
      userId: p.userId,
      name: p.name,
      organizationId: p.organizationId,
      organizationName: p.organizationName,
      organizationPath: p.organizationPath,
      eligible: p.eligible,
      held: p.held,
      inactive: p.inactive,
      key,
    });
    const cellRow = (
      p: DashboardPerson,
      c: DashboardQualificationCell,
    ): DashboardDetailRow => ({
      ...base(p, pairKey(p.userId, c.entityId)),
      entityId: c.entityId,
      title: c.title,
      efficacy: c.efficacy,
      progress: c.progress,
      assignmentId: c.assignmentId,
      planId: c.planId,
      certificationId: c.certificationId,
      acquisitionBlockCodes: c.acquisitionBlockCodes,
    });
    let unit: DashboardDetails["unit"] = "people";
    if (metric === "eligiblePeople")
      rows = metricMembers.map((p) => base(p, p.userId));
    else if (metric === "excludedPeople")
      rows = people.filter((p) => !p.eligible).map((p) => base(p, p.userId));
    else if (metric === "uniqueActiveHolders")
      rows = metricMembers
        .filter((p) => p.activeQualifications > 0)
        .map((p) => base(p, p.userId));
    else if (["inProgress", "blockedProgress"].includes(metric)) {
      unit = "person_qualification";
      rows = metricMembers.flatMap((p) =>
        p.cells
          .filter((c) =>
            metric === "blockedProgress"
              ? c.acquisitionBlockCodes.length > 0
              : activeProgress(c),
          )
          .map((c) => cellRow(p, c)),
      );
    } else if (
      metric === "incompleteRequests" ||
      metric === "overdueRequests"
    ) {
      unit = "requests";
      rows = relevantRequests
        .filter((r) => metric === "incompleteRequests" || r.dueOn < date)
        .map((r) => ({
          ...base(personById.get(r.learnerId)!, r.id),
          requestId: r.id,
          dueOn: r.dueOn,
        }));
    } else if (metric === "expires0to30") {
      unit = "credentials";
      rows = metricRenewals
        .filter((r) => r.expiryBucket === "0_30")
        .map((r) => ({
          ...base(r, r.certificationId),
          entityId: r.entityId,
          title: r.title,
          efficacy: r.efficacy,
          certificationId: r.certificationId,
          assignmentId: r.assignmentId,
          expiresOn: r.expiresOn,
        }));
    } else if (metric === "overdueTargets") {
      unit = "person_qualification";
      rows = overdueTargets.map(({ p, c }) => ({
        ...cellRow(p, c),
        dueOn: c.targetOn,
      }));
    } else if (metric === "overdueAssessments") {
      unit = "enrollments";
      rows = overdueAssessments.map(({ p, c, e, dueOn }) => ({
        ...cellRow(p, c),
        key: e.id,
        enrollmentId: e.id,
        courseTitle: courses.get(e.courseId)?.title,
        dueOn,
      }));
    }
    const detailSort =
      query.sort ||
      (metric.startsWith("overdue")
        ? "dueOn"
        : metric === "expires0to30"
          ? "expiresOn"
          : "organization");
    return {
      snapshot,
      metric,
      unit,
      rows: page(
        sortRows(
          rows,
          (r) =>
            detailSort === "dueOn"
              ? r.dueOn || "9999"
              : detailSort === "expiresOn"
                ? r.expiresOn || "9999"
                : detailSort === "qualification"
                  ? r.title || ""
                  : detailSort === "organization"
                    ? r.organizationPath.map((o) => o.name).join("/")
                    : r.name,
          (r) =>
            query.sort
              ? [r.key]
              : [
                  r.organizationPath.map((o) => o.name).join("/"),
                  r.title || "",
                  r.name,
                  r.key,
                ],
        ),
      ),
    };
  }
  function member(id: string): DashboardMemberDetail {
    const p = personById.get(id);
    demand(p, 403, "조회 범위의 구성원이 아닙니다.", "DASHBOARD_FORBIDDEN");
    stale();
    const qualificationRows = selectedOptions
      .map((o) => cell(p, o))
      .filter((c) => c.selected || c.efficacy !== "none");
    const detailHref = (id: string) =>
      scope.fullManager
        ? `/admin/results/${encodeURIComponent(id)}?lv1OrganizationId=${encodeURIComponent(scope.lv1OrganizationId)}`
        : undefined;
    const history = assignments
      .filter(
        (a) =>
          a.learnerId === id &&
          (!query.entityId || entityOf(a.qualificationId) === query.entityId),
      )
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
      .map((a) => {
        const q = qualifications.get(a.qualificationId)!,
          c = certsByAssignment.get(a.id);
        return {
          assignmentId: a.id,
          entityId: q.entityId,
          title: a.qualificationMetadata?.title || q.title,
          version: numberedQualificationVersion(q),
          assignedOn: kstDate(a.assignedAt),
          organizationPath: a.organizationPath,
          currentOrganization:
            a.organizationPath.at(-1)?.id === p.organizationId,
          excluded: !!a.excludedReason,
          closed: !!a.acquisitionClosedAt,
          efficacy: c ? effectiveCredentialStatus(c, at) : ("none" as const),
          ...(c ? { certificationId: c.id, issuedOn: kstDate(c.date) } : {}),
          ...(scope.fullManager ? { detailsHref: detailHref(a.id) } : {}),
        };
      });
    const previousPlanningRecords: DashboardMemberDetail["previousPlanningRecords"] =
      [
        ...s.planningRequests
          .filter(
            (r) =>
              r.learnerId === id &&
              r.lv1OrganizationId === scope.lv1OrganizationId &&
              r.organizationId !== p.organizationId &&
              (!query.entityId ||
                r.selections.some((t) => t.entityId === query.entityId)),
          )
          .map((r) => ({
            kind: "request" as const,
            id: r.id,
            title:
              r.selections.map((t) => t.title).join(" · ") || "계획 수립 요청",
            createdOn: kstDate(r.createdAt),
            dueOn: r.dueOn,
            ...(r.closed
              ? {
                  closedOn: kstDate(r.closed.date),
                  closeReason: r.closed.reason,
                }
              : {}),
            ...(r.completion
              ? { completedOn: kstDate(r.completion.date) }
              : {}),
            organizationPath:
              r.organizationPath ||
              orgs.get(r.organizationId || "")?.path ||
              [],
          })),
        ...allPlans
          .filter(
            (plan) =>
              plan.learnerId === id &&
              plan.status === "draft" &&
              plan.organizationId !== p.organizationId &&
              (!query.entityId ||
                entityOf(plan.qualificationId) === query.entityId),
          )
          .map((plan) => ({
            kind: "draft" as const,
            id: plan.id,
            title:
              plan.qualificationMetadata?.title ||
              qualifications.get(plan.qualificationId)?.title ||
              "자격 계획",
            createdOn: kstDate(plan.createdAt),
            ...(plan.targetOn ? { dueOn: plan.targetOn } : {}),
            organizationPath:
              requestById.get(plan.requestId)?.organizationPath ||
              orgs.get(plan.organizationId || "")?.path ||
              [],
          })),
      ].sort((a, b) => b.createdOn.localeCompare(a.createdOn));
    return {
      snapshot,
      person: p,
      previousPlanningRecords,
      qualifications: qualificationRows.map((c) => {
        const assignment = c.assignmentId && assignmentById.get(c.assignmentId);
        const plan =
          assignment && assignment.planId && planById.get(assignment.planId);
        const schedules = new Map(
          (plan ? plan.schedules : []).map((schedule) => [
            schedule.courseId,
            schedule,
          ]),
        );
        const ens = c.assignmentId
          ? enrollmentsByAssignment.get(c.assignmentId) || []
          : [];
        const summaries = ens.map((e): DashboardCourseSummary => {
          const course = courses.get(e.courseId)!,
            done = completionsByEnrollment.get(e.id),
            ts = attemptsByEnrollment.get(e.id) || [];
          const state = (kind: "objective" | "practical") =>
            course.qualificationType === "auditor" ||
            !course.assessmentKinds.includes(kind)
              ? "not_required"
              : ts.some((t) => t.kind === kind && t.result === "passed")
                ? "passed"
                : ts.some((t) => t.kind === kind && t.status === "in_progress")
                  ? "draft"
                  : ts.some((t) => t.kind === kind && t.result === "failed")
                    ? "failed"
                    : "ready";
          return {
            courseId: course.id,
            qualificationType: course.qualificationType,
            requiredItems: course.learningItems.filter((i) => i.required)
              .length,
            confirmedItems: course.learningItems.filter(
              (i) =>
                i.required &&
                s.learningChecklists.some(
                  (c) =>
                    c.enrollmentId === e.id &&
                    c.items.some((v) => v.itemId === i.id),
                ),
            ).length,
            title: done?.snapshot?.title || course.title,
            version: course.version,
            completed: !!done,
            ...(done ? { completedOn: kstDate(done.date) } : {}),
            ...(schedules.get(course.id)?.assessmentOn
              ? { assessmentOn: schedules.get(course.id)!.assessmentOn }
              : {}),
            objective: state("objective"),
            practical: state("practical"),
          };
        });
        return {
          ...c,
          courses: summaries,
          ...(scope.fullManager && c.assignmentId
            ? { detailsHref: detailHref(c.assignmentId) }
            : {}),
        };
      }),
      requests: (requestsByUser.get(id) || []).map((r) => ({
        id: r.id,
        createdOn: kstDate(r.createdAt),
        dueOn: r.dueOn,
        ...(r.closed
          ? { closedOn: kstDate(r.closed.date), closeReason: r.closed.reason }
          : {}),
        ...(r.completion ? { completedOn: kstDate(r.completion.date) } : {}),
        selectedTitles: r.selections.map((t) => t.title),
      })),
      history,
    };
  }
  return { options, dashboard, details, member, chartDetails };
}
