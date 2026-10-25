/** Read-only, server-scoped dashboard projections. No assessment answers or private reasons. */
export type DashboardView =
  | "summary"
  | "organizations"
  | "qualifications"
  | "members"
  | "matrix"
  | "renewals";
export type DashboardPopulation = "eligible" | "excluded" | "all";
export type DashboardEfficacy = "Active" | "Hold" | "Revoke" | "none";
export type DashboardProgress =
  | "unplanned"
  | "draft"
  | "learning_wait"
  | "learning_progress"
  | "assessment_wait"
  | "assessment_progress"
  | "partial_completion"
  | "none";
export type DashboardRenewalState =
  | "available"
  | "in_progress"
  | "upcoming"
  | "scheduled"
  | "blocked"
  | "not_applicable";
export type DashboardExpiryBucket =
  | "0_30"
  | "31_60"
  | "61_90"
  | "over_90"
  | "unlimited"
  | "unknown"
  | "expired"
  | "revoked";
export type DashboardMetric =
  | "eligiblePeople"
  | "requiredCoverage"
  | "requiredMissing"
  | "blockedProgress"
  | "fullyRequiredPeople"
  | "uniqueActiveHolders"
  | "inProgress"
  | "incompleteRequests"
  | "expires0to30"
  | "overdueRequests"
  | "overdueTargets"
  | "overdueAssessments"
  | "excludedPeople";
export interface DashboardQuery {
  qualificationType?: "auditee" | "auditor";
  lv1OrganizationId?: string;
  organizationId?: string;
  includeDescendants?: boolean;
  population?: DashboardPopulation;
  view?: DashboardView;
  search?: string;
  entityId?: string;
  required?: "all" | "required" | "optional";
  efficacy?: DashboardEfficacy;
  progress?: DashboardProgress;
  qualificationScope?: "all" | "applied" | "records";
  expiryBucket?: DashboardExpiryBucket;
  renewalState?: DashboardRenewalState;
  sort?:
    | "name"
    | "organization"
    | "qualification"
    | "coverage"
    | "expiresOn"
    | "targetOn"
    | "dueOn";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: 25 | 50 | 100;
  columnPage?: number;
  metric?: DashboardMetric;
  expectedStateRevision?: number;
  expectedOrganizationRevision?: number;
  expectedDate?: string;
  chartId?: DashboardChartId;
  groupKey?: string;
  seriesKey?: string;
}
export interface DashboardScope {
  lv1OrganizationId: string;
  organizationId: string;
  organizationName: string;
  organizationPath: { id: string; name: string }[];
  includeDescendants: boolean;
  directOnly: boolean;
  fullManager: boolean;
}
export interface DashboardExclusions {
  totalPeople: number;
  eligiblePeople: number;
  excludedPeople: number;
  heldPeople: number;
  inactivePeople: number;
  heldAndInactivePeople: number;
}
export interface DashboardSnapshot {
  asOf: string;
  date: string;
  stateRevision: number;
  organizationRevision: number;
  scope: DashboardScope;
  exclusions: DashboardExclusions;
}
export interface DashboardPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}
/** rate is an unrounded percentage (0–100); null means an empty denominator. */
export interface DashboardCoverage {
  fulfilled: number;
  total: number;
  rate: number | null;
}
export interface DashboardSummary {
  eligiblePeople: number;
  /** Filtered person–qualification pairs; the requiredCoverage detail returns this exact denominator. */
  requiredCoverage: DashboardCoverage;
  requiredMissing: number;
  blockedProgress: number;
  /** Full current organizational requirements for each matching person, unaffected by qualification/status filters. */
  fullyRequiredPeople: number;
  peopleWithRequirements: number;
  peopleWithoutRequirements: number;
  uniqueActiveHolders: number;
  inProgress: number;
  incompleteRequests: number;
  expires0to30: number;
  overdueRequests: number;
  overdueTargets: number;
  overdueAssessments: number;
  efficacy: Record<DashboardEfficacy, number>;
  progress: Record<DashboardProgress, number>;
}
export interface DashboardQualificationOption {
  entityId: string;
  title: string;
  applied: boolean;
  appliedQualificationId?: string;
  appliedVersion?: number;
  criterionStatus?: "Active" | "Hold" | "Revoke";
  hasRecords: boolean;
}
export interface DashboardOptions {
  snapshot: DashboardSnapshot;
  organizations: {
    id: string;
    name: string;
    parentId: string | null;
    level: number;
    path: { id: string; name: string }[];
    active: boolean;
  }[];
  qualifications: DashboardQualificationOption[];
}
export interface DashboardPerson {
  userId: string;
  name: string;
  organizationId: string;
  organizationName: string;
  organizationPath: { id: string; name: string }[];
  eligible: boolean;
  held: boolean;
  inactive: boolean;
}
export interface DashboardQualificationCell {
  entityId: string;
  title: string;
  required: boolean;
  applied: boolean;
  appliedVersion?: number;
  efficacy: DashboardEfficacy;
  progress: DashboardProgress;
  selected: boolean;
  certificationId?: string;
  assignmentId?: string;
  planId?: string;
  recordQualificationId?: string;
  recordTitle?: string;
  recordVersion?: number;
  issuedOn?: string;
  expiresOn?: string;
  expiryBucket?: DashboardExpiryBucket;
  targetOn?: string;
  renewalState: DashboardRenewalState;
  renewalOpensOn?: string;
  renewalBlockCodes: string[];
  acquisitionBlockCodes: string[];
  completedCourses: number;
  totalCourses: number;
}
export interface DashboardMemberRow extends DashboardPerson {
  /** All of this person's current organizational requirements, irrespective of the visible qualification columns. */
  requiredCoverage: DashboardCoverage;
  activeQualifications: number;
  inProgress: number;
  incompleteRequests: number;
  overdueRequests: number;
  nextSchedule?: {
    kind: "request" | "target" | "assessment";
    date: string;
    title?: string;
    entityId?: string;
    courseTitle?: string;
  };
  /** members: up to two pending rows; matrix: the requested ten-column window. */
  cells: DashboardQualificationCell[];
}
export interface DashboardOrganizationRow {
  organizationId: string;
  name: string;
  direct: boolean;
  people: number;
  excludedPeople: number;
  requiredCoverage: DashboardCoverage;
  fullyRequiredPeople: number;
  activeHolders: number;
  inProgress: number;
  expires0to30: number;
  overdueRequests: number;
  overdueTargets: number;
  overdueAssessments: number;
}
export interface DashboardQualificationRow extends DashboardQualificationOption {
  requiredPeople: number;
  requiredCoverage: DashboardCoverage;
  activePeople: number;
  heldPeople: number;
  revokedPeople: number;
  inProgress: number;
  unplanned: number;
  expires0to30: number;
}
export interface DashboardRenewalRow extends DashboardPerson {
  entityId: string;
  title: string;
  recordTitle: string;
  recordVersion: number;
  certificationId: string;
  assignmentId: string;
  efficacy: Exclude<DashboardEfficacy, "none">;
  issuedOn: string;
  expiresOn?: string;
  daysUntilExpiry?: number;
  expiryBucket: DashboardExpiryBucket;
  renewalState: DashboardRenewalState;
  renewalOpensOn?: string;
  renewalBlockCodes: string[];
}
export interface DashboardResponse {
  snapshot: DashboardSnapshot;
  view: DashboardView;
  summary: DashboardSummary;
  charts: DashboardChart[];
  organizations: DashboardPage<DashboardOrganizationRow>;
  qualifications: DashboardPage<DashboardQualificationRow>;
  members: DashboardPage<DashboardMemberRow>;
  renewals: DashboardPage<DashboardRenewalRow>;
  matrix: {
    members: DashboardPage<DashboardMemberRow>;
    columns: DashboardPage<DashboardQualificationOption>;
  };
}
export interface DashboardDetailRow extends DashboardPerson {
  key: string;
  entityId?: string;
  title?: string;
  required?: boolean;
  fulfilled?: boolean;
  efficacy?: DashboardEfficacy;
  progress?: DashboardProgress;
  requestId?: string;
  planId?: string;
  assignmentId?: string;
  certificationId?: string;
  enrollmentId?: string;
  courseTitle?: string;
  dueOn?: string;
  expiresOn?: string;
  acquisitionBlockCodes?: string[];
  requiredCoverage?: DashboardCoverage;
}
export type DashboardChartId =
  | "required-coverage"
  | "progress"
  | "organization-coverage"
  | "organization-people"
  | "qualification-coverage"
  | "qualification-efficacy"
  | "qualification-progress"
  | "member-coverage"
  | "expiry"
  | "renewal";
export type DashboardChartTone =
  "success" | "neutral" | "primary" | "warning" | "danger" | "navy";
export interface DashboardChartSeries {
  key: string;
  label: string;
  tone: DashboardChartTone;
}
export interface DashboardChartGroup {
  key: string;
  label: string;
  values: number[];
  denominator?: number;
}
export interface DashboardChart {
  id: DashboardChartId;
  title: string;
  kind: "donut" | "bar" | "stacked" | "grouped";
  unit: DashboardDetails["unit"];
  comparison: boolean;
  percentage?: boolean;
  series: DashboardChartSeries[];
  groups: DashboardChartGroup[];
  emptyLabel: string;
}
export interface DashboardChartSelection {
  chartId: DashboardChartId;
  groupKey: string;
  seriesKey: string;
}
export interface DashboardChartDetails {
  snapshot: DashboardSnapshot;
  title: string;
  selection: DashboardChartSelection;
  unit: DashboardDetails["unit"];
  rows: DashboardPage<DashboardDetailRow>;
}
export interface DashboardDetails {
  snapshot: DashboardSnapshot;
  metric: DashboardMetric;
  unit:
    | "people"
    | "person_qualification"
    | "requests"
    | "credentials"
    | "enrollments";
  numerator?: number;
  denominator?: number;
  rows: DashboardPage<DashboardDetailRow>;
}
export interface DashboardCourseSummary {
  qualificationType?: "auditee" | "auditor";
  confirmedItems?: number;
  requiredItems?: number;
  courseId: string;
  title: string;
  version: number;
  completed: boolean;
  completedOn?: string;
  assessmentOn?: string;
  objective: "not_required" | "ready" | "draft" | "passed" | "failed";
  practical: "not_required" | "ready" | "draft" | "passed" | "failed";
}
export interface DashboardMemberEvidence extends DashboardQualificationCell {
  courses: DashboardCourseSummary[];
  detailsHref?: string;
}
export interface DashboardHistoricalRecord {
  assignmentId: string;
  entityId: string;
  title: string;
  version: number;
  assignedOn: string;
  organizationPath: { id: string; name: string }[];
  currentOrganization: boolean;
  excluded: boolean;
  closed: boolean;
  certificationId?: string;
  efficacy: DashboardEfficacy;
  issuedOn?: string;
  detailsHref?: string;
}
export interface DashboardMemberDetail {
  snapshot: DashboardSnapshot;
  person: DashboardPerson;
  qualifications: DashboardMemberEvidence[];
  requests: {
    id: string;
    createdOn: string;
    dueOn: string;
    completedOn?: string;
    requiredTitles: string[];
    selectedTitles: string[];
  }[];
  history: DashboardHistoricalRecord[];
  previousPlanningRecords: {
    kind: "request" | "draft";
    id: string;
    title: string;
    createdOn: string;
    dueOn?: string;
    completedOn?: string;
    organizationPath: { id: string; name: string }[];
  }[];
}
