import type {
  DashboardChart,
  DashboardChartId,
  DashboardChartSeries,
  DashboardChartSelection,
  DashboardDetailRow,
  DashboardMemberRow,
  DashboardOrganizationRow,
  DashboardQualificationRow,
  DashboardQualificationCell,
  DashboardRenewalRow,
  DashboardScope,
  DashboardView,
} from "@eks/contracts";
import { demand } from "./errors.ts";

const progress: DashboardChartSeries[] = [
  { key: "unplanned", label: "계획 미작성", tone: "neutral" },
  { key: "draft", label: "계획 작성", tone: "primary" },
  { key: "learning_wait", label: "학습 확인 대기", tone: "warning" },
  { key: "learning_progress", label: "학습 확인 중", tone: "navy" },
  { key: "assessment_wait", label: "평가 대기", tone: "warning" },
  { key: "assessment_progress", label: "평가 진행", tone: "navy" },
  { key: "partial_completion", label: "일부 수료", tone: "success" },
];
const required: DashboardChartSeries[] = [
  { key: "fulfilled", label: "충족", tone: "success" },
  { key: "missing", label: "미충족", tone: "neutral" },
];
const expiry: DashboardChartSeries[] = [
  { key: "0_30", label: "오늘~30일 내", tone: "danger" },
  { key: "31_60", label: "31~60일 내", tone: "warning" },
  { key: "61_90", label: "61~90일 내", tone: "primary" },
  { key: "over_90", label: "90일 초과", tone: "navy" },
  { key: "expired", label: "기간 만료", tone: "danger" },
  { key: "revoked", label: "수동 폐기", tone: "neutral" },
  { key: "unlimited", label: "무기한", tone: "success" },
  { key: "unknown", label: "기간 미정", tone: "neutral" },
];
type Pair = { person: DashboardMemberRow; cell: DashboardQualificationCell };
export function dashboardCharts(input: {
  view: DashboardView;
  scope: DashboardScope;
  members: DashboardMemberRow[];
  renewals: DashboardRenewalRow[];
  organizations: DashboardOrganizationRow[];
  qualifications: DashboardQualificationRow[];
}) {
  const { view, scope, members, renewals, organizations, qualifications } =
    input;
  const charts: DashboardChart[] = [];
  const selectors = new Map<
    DashboardChartId,
    (group: string, series: string) => DashboardDetailRow[]
  >();
  const people = (rows: DashboardMemberRow[]) =>
    rows.map((p): DashboardDetailRow => ({
      userId: p.userId,
      name: p.name,
      organizationId: p.organizationId,
      organizationName: p.organizationName,
      organizationPath: p.organizationPath,
      eligible: p.eligible,
      held: p.held,
      inactive: p.inactive,
      key: p.userId,
      requiredCoverage: p.requiredCoverage,
    }));
  const pairRows = (pairs: Pair[]) =>
    pairs.map(({ person: p, cell: c }): DashboardDetailRow => ({
      ...people([p])[0]!,
      key: p.userId + ":" + c.entityId,
      entityId: c.entityId,
      title: c.title,
      required: c.required,
      fulfilled: c.efficacy === "Active",
      efficacy: c.efficacy,
      progress: c.progress,
      assignmentId: c.assignmentId,
      planId: c.planId,
      certificationId: c.certificationId,
      acquisitionBlockCodes: c.acquisitionBlockCodes,
    }));
  const pairs = members.flatMap((person) =>
    person.cells.map((cell) => ({ person, cell })),
  );
  const requiredPairs = pairs.filter((p) => p.cell.required);
  const activePairs = pairs.filter((p) =>
    progress.some((s) => s.key === p.cell.progress),
  );
  const byEntity = new Map<string, Pair[]>();
  for (const p of pairs) {
    const list = byEntity.get(p.cell.entityId) || [];
    list.push(p);
    byEntity.set(p.cell.entityId, list);
  }
  function add(
    chart: DashboardChart,
    select: (group: string, series: string) => DashboardDetailRow[],
  ) {
    charts.push(chart);
    selectors.set(chart.id, select);
  }
  function distribution(
    id: DashboardChartId,
    title: string,
    series: DashboardChartSeries[],
    rows: Pair[],
    kind: "bar" | "donut",
    match: (pair: Pair, key: string) => boolean,
  ) {
    add(
      {
        id,
        title,
        kind,
        unit: "person_qualification",
        comparison: false,
        series,
        groups: [
          {
            key: "all",
            label: title,
            values: series.map(
              (s) => rows.filter((p) => match(p, s.key)).length,
            ),
          },
        ],
        emptyLabel:
          id === "required-coverage"
            ? "필수 자격 없음"
            : "해당하는 취득 진행이 없습니다.",
      },
      (_group, key) => pairRows(rows.filter((p) => match(p, key))),
    );
  }
  if (view === "summary") {
    distribution(
      "required-coverage",
      "필수 자격 충족",
      required,
      requiredPairs,
      "donut",
      (p, key) => (p.cell.efficacy === "Active") === (key === "fulfilled"),
    );
  }
  if (["summary", "members", "matrix"].includes(view)) {
    distribution(
      "progress",
      "계획·취득 단계",
      progress,
      activePairs,
      "bar",
      (p, key) => p.cell.progress === key,
    );
  }
  if ((view === "summary" || view === "organizations") && !scope.directOnly) {
    const groupKey = (org: DashboardOrganizationRow) =>
      org.organizationId + (org.direct ? ":direct" : ":subtree");
    const belongs = (p: DashboardMemberRow, org: DashboardOrganizationRow) =>
      org.direct
        ? p.organizationId === org.organizationId
        : p.organizationPath.some((o) => o.id === org.organizationId);
    add(
      {
        id: "organization-coverage",
        title: "조직별 필수 충족률",
        kind: "stacked",
        unit: "person_qualification",
        comparison: true,
        percentage: true,
        series: required,
        emptyLabel: "집계할 대상이 없습니다.",
        groups: organizations.map((org) => ({
          key: groupKey(org),
          label: org.name + (org.direct ? " · 직속" : ""),
          denominator: org.requiredCoverage.total,
          values: [
            org.requiredCoverage.fulfilled,
            org.requiredCoverage.total - org.requiredCoverage.fulfilled,
          ],
        })),
      },
      (key, series) => {
        const org = organizations.find((org) => groupKey(org) === key)!;
        return pairRows(
          requiredPairs.filter(
            (p) =>
              belongs(p.person, org) &&
              (p.cell.efficacy === "Active") === (series === "fulfilled"),
          ),
        );
      },
    );
    if (view === "organizations")
      add(
        {
          id: "organization-people",
          title: "조직별 대상·유효 보유 인원",
          kind: "grouped",
          unit: "people",
          comparison: true,
          series: [
            { key: "eligible", label: "대상 인원", tone: "neutral" },
            { key: "active", label: "유효 보유 인원", tone: "primary" },
          ],
          groups: organizations.map((org) => ({
            key: groupKey(org),
            label: org.name + (org.direct ? " · 직속" : ""),
            values: [org.people, org.activeHolders],
          })),
          emptyLabel: "집계할 대상이 없습니다.",
        },
        (key, series) => {
          const org = organizations.find((org) => groupKey(org) === key)!;
          return people(
            members.filter(
              (p) =>
                belongs(p, org) &&
                (series !== "active" || p.activeQualifications > 0),
            ),
          );
        },
      );
  }
  if (view === "qualifications") {
    const common = {
      comparison: true,
      emptyLabel: "집계할 기록이 없습니다.",
    };
    add(
      {
        ...common,
        id: "qualification-coverage",
        title: "자격별 필수 충족률",
        kind: "stacked",
        unit: "person_qualification",
        percentage: true,
        series: required,
        groups: qualifications.map((q) => ({
          key: q.entityId,
          label: q.title,
          denominator: q.requiredCoverage.total,
          values: [
            q.requiredCoverage.fulfilled,
            q.requiredCoverage.total - q.requiredCoverage.fulfilled,
          ],
        })),
      },
      (key, series) =>
        pairRows(
          (byEntity.get(key) || []).filter(
            (p) =>
              p.cell.required &&
              (p.cell.efficacy === "Active") === (series === "fulfilled"),
          ),
        ),
    );
    const efficacy: DashboardChartSeries[] = [
      { key: "Active", label: "Active · 유효", tone: "success" },
      { key: "Hold", label: "Hold · 정지", tone: "warning" },
      { key: "Revoke", label: "Revoke · 폐기", tone: "danger" },
    ];
    add(
      {
        ...common,
        id: "qualification-efficacy",
        title: "자격별 보유 효력",
        kind: "stacked",
        unit: "person_qualification",
        series: efficacy,
        groups: qualifications.map((q) => ({
          key: q.entityId,
          label: q.title,
          values: [q.activePeople, q.heldPeople, q.revokedPeople],
        })),
      },
      (key, series) =>
        pairRows(
          (byEntity.get(key) || []).filter((p) => p.cell.efficacy === series),
        ),
    );
    add(
      {
        ...common,
        id: "qualification-progress",
        title: "자격별 계획·취득 단계",
        kind: "stacked",
        unit: "person_qualification",
        series: progress,
        groups: qualifications.map((q) => ({
          key: q.entityId,
          label: q.title,
          values: progress.map(
            (s) =>
              (byEntity.get(q.entityId) || []).filter(
                (p) => p.cell.progress === s.key,
              ).length,
          ),
        })),
      },
      (key, series) =>
        pairRows(
          (byEntity.get(key) || []).filter((p) => p.cell.progress === series),
        ),
    );
  }
  if (view === "members" || view === "matrix") {
    const memberSeries: DashboardChartSeries[] = [
      { key: "full", label: "전체 충족", tone: "success" },
      { key: "partial", label: "일부 충족", tone: "primary" },
      { key: "missing", label: "미충족", tone: "warning" },
      { key: "none", label: "필수 없음", tone: "neutral" },
    ];
    const state = (p: DashboardMemberRow) =>
      !p.requiredCoverage.total
        ? "none"
        : p.requiredCoverage.fulfilled === p.requiredCoverage.total
          ? "full"
          : p.requiredCoverage.fulfilled
            ? "partial"
            : "missing";
    const chart: DashboardChart = {
      id: "member-coverage",
      title: "구성원 필수 충족 분포",
      kind: "donut",
      unit: "people",
      comparison: false,
      series: memberSeries,
      groups: [
        {
          key: "all",
          label: "구성원",
          values: memberSeries.map(
            (s) => members.filter((p) => state(p) === s.key).length,
          ),
        },
      ],
      emptyLabel: "조건에 맞는 구성원이 없습니다.",
    };
    add(chart, (_group, series) =>
      people(members.filter((p) => state(p) === series)),
    );
    // People first, progress second.
    charts.sort((a, b) =>
      a.id === "member-coverage" ? -1 : b.id === "member-coverage" ? 1 : 0,
    );
  }
  if (view === "summary" || view === "renewals") {
    const buckets = view === "summary" ? expiry.slice(0, 3) : expiry;
    const certRows = (rows: DashboardRenewalRow[]) =>
      rows.map((p): DashboardDetailRow => ({
        userId: p.userId,
        name: p.name,
        organizationId: p.organizationId,
        organizationName: p.organizationName,
        organizationPath: p.organizationPath,
        eligible: p.eligible,
        held: p.held,
        inactive: p.inactive,
        key: p.certificationId,
        entityId: p.entityId,
        title: p.title,
        certificationId: p.certificationId,
        assignmentId: p.assignmentId,
        efficacy: p.efficacy,
        expiresOn: p.expiresOn,
      }));
    add(
      {
        id: "expiry",
        title: view === "summary" ? "90일 내 만료 예정" : "만료 구간별 인증",
        kind: "bar",
        unit: "credentials",
        comparison: false,
        series: buckets,
        groups: [
          {
            key: "all",
            label: "만료 구간",
            values: buckets.map(
              (s) => renewals.filter((r) => r.expiryBucket === s.key).length,
            ),
          },
        ],
        emptyLabel:
          view === "summary"
            ? "90일 내 만료 예정 인증이 없습니다."
            : "조건에 맞는 인증이 없습니다.",
      },
      (_group, series) =>
        certRows(renewals.filter((r) => r.expiryBucket === series)),
    );
    if (view === "renewals") {
      const states: DashboardChartSeries[] = [
        { key: "available", label: "재인증 가능", tone: "primary" },
        { key: "in_progress", label: "재인증 진행", tone: "navy" },
        { key: "upcoming", label: "재인증 예정", tone: "warning" },
        { key: "scheduled", label: "시작 전", tone: "neutral" },
        { key: "blocked", label: "확인 필요", tone: "danger" },
        { key: "not_applicable", label: "해당 없음", tone: "neutral" },
      ];
      add(
        {
          id: "renewal",
          title: "재인증 상태",
          kind: "bar",
          unit: "credentials",
          comparison: false,
          series: states,
          groups: [
            {
              key: "all",
              label: "재인증",
              values: states.map(
                (s) => renewals.filter((r) => r.renewalState === s.key).length,
              ),
            },
          ],
          emptyLabel: "조건에 맞는 인증이 없습니다.",
        },
        (_group, series) =>
          certRows(renewals.filter((r) => r.renewalState === series)),
      );
    }
  }
  return {
    charts,
    details(selection: DashboardChartSelection) {
      const chart = charts.find((c) => c.id === selection.chartId);
      demand(chart, 403, "조회할 수 없는 차트입니다.", "DASHBOARD_FORBIDDEN");
      const group = chart.groups.find((g) => g.key === selection.groupKey);
      const series = chart.series.find((s) => s.key === selection.seriesKey);
      demand(
        group && series,
        403,
        "조회할 수 없는 차트 구간입니다.",
        "DASHBOARD_FORBIDDEN",
      );
      return {
        title:
          chart.title +
          " · " +
          (chart.comparison ? group.label + " · " : "") +
          series.label,
        unit: chart.unit,
        rows: selectors.get(chart.id)!(group.key, series.key),
      };
    },
  };
}
