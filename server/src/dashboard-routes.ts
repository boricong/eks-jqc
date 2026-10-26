import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  DashboardMetric,
  DashboardQuery,
  DashboardChartSelection,
  State,
  UserView,
} from "@eks/contracts";
import type { JsonStore } from "./storage.ts";
import { dashboardReader } from "./dashboard.ts";

const booleanQuery = z.preprocess(
  (value) =>
    value === "true" || value === "1"
      ? true
      : value === "false" || value === "0"
        ? false
        : value,
  z.boolean(),
);
const querySchema = z
  .object({
    qualificationType: z.enum(["auditee", "auditor"]).optional(),
    lv1OrganizationId: z.string().min(1).max(160).optional(),
    organizationId: z.string().min(1).max(160).optional(),
    includeDescendants: booleanQuery.optional(),
    population: z.enum(["eligible", "excluded", "all"]).optional(),
    view: z
      .enum([
        "summary",
        "organizations",
        "qualifications",
        "members",
        "matrix",
        "renewals",
      ])
      .optional(),
    search: z.string().max(300).optional(),
    entityId: z.string().min(1).max(160).optional(),
    required: z.enum(["all", "required", "optional"]).optional(),
    efficacy: z.enum(["Active", "Hold", "Revoke", "none"]).optional(),
    progress: z
      .enum([
        "unplanned",
        "draft",
        "learning_wait",
        "learning_progress",
        "assessment_wait",
        "assessment_progress",
        "partial_completion",
        "none",
      ])
      .optional(),
    qualificationScope: z.preprocess(
      (v) => (v === "applied" ? "registered" : v),
      z.enum(["all", "registered", "records"]).optional(),
    ),
    expiryBucket: z
      .enum([
        "0_30",
        "31_60",
        "61_90",
        "over_90",
        "unlimited",
        "unknown",
        "expired",
        "revoked",
      ])
      .optional(),
    renewalState: z
      .enum([
        "available",
        "in_progress",
        "upcoming",
        "scheduled",
        "blocked",
        "not_applicable",
      ])
      .optional(),
    sort: z
      .enum([
        "name",
        "organization",
        "qualification",
        "coverage",
        "expiresOn",
        "targetOn",
        "dueOn",
      ])
      .optional(),
    order: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).max(100000).optional(),
    pageSize: z.coerce
      .number()
      .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
      .optional(),
    columnPage: z.coerce.number().int().min(1).max(100000).optional(),
    metric: z
      .enum([
        "eligiblePeople",
        "requiredCoverage",
        "requiredMissing",
        "blockedProgress",
        "fullyRequiredPeople",
        "uniqueActiveHolders",
        "inProgress",
        "incompleteRequests",
        "expires0to30",
        "overdueRequests",
        "overdueTargets",
        "overdueAssessments",
        "excludedPeople",
      ])
      .optional(),
    chartId: z
      .enum([
        "required-coverage",
        "progress",
        "organization-coverage",
        "organization-people",
        "qualification-coverage",
        "qualification-efficacy",
        "qualification-progress",
        "member-coverage",
        "expiry",
        "renewal",
      ])
      .optional(),
    groupKey: z.string().min(1).max(200).optional(),
    seriesKey: z.string().min(1).max(80).optional(),
    expectedStateRevision: z.coerce.number().int().nonnegative().optional(),
    expectedOrganizationRevision: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional(),
    expectedDate: z.iso.date().optional(),
  })
  .strict();

export function registerDashboardRoutes(
  app: FastifyInstance,
  store: JsonStore,
  actor: (r: FastifyRequest, s?: State) => UserView,
  clock: () => string,
) {
  const read = (
    request: FastifyRequest,
    kind: "options" | "dashboard" | "details" | "member" | "chart-details",
  ) => {
    const query: DashboardQuery = querySchema.parse(request.query);
    if (kind === "details")
      query.metric = z
        .string()
        .pipe(querySchema.shape.metric.unwrap())
        .parse(query.metric) as DashboardMetric;
    let selection: DashboardChartSelection | undefined;
    if (kind === "chart-details")
      selection = z
        .object({
          chartId: querySchema.shape.chartId.unwrap(),
          groupKey: querySchema.shape.groupKey.unwrap(),
          seriesKey: querySchema.shape.seriesKey.unwrap(),
        })
        .parse(query);
    return store.consistent((state, organizations) => {
      // Reauthenticate inside the shared storage queue. A queued role/scope change applies to this read.
      const current = actor(request, state),
        at = clock();
      const reader = dashboardReader(state, organizations, current, query, at);
      if (kind === "chart-details") return reader.chartDetails(selection!);
      if (kind === "options") return reader.options();
      if (kind === "details") return reader.details(query.metric!);
      if (kind === "member")
        return reader.member(
          z
            .string()
            .min(1)
            .max(160)
            .parse((request.params as { userId: string }).userId),
        );
      return reader.dashboard();
    });
  };
  app.get("/api/dashboard/chart-details", (r) => read(r, "chart-details"));
  app.get("/api/dashboard/options", (r) => read(r, "options"));
  app.get("/api/dashboard", (r) => read(r, "dashboard"));
  app.get("/api/dashboard/details", (r) => read(r, "details"));
  app.get("/api/dashboard/members/:userId", (r) => read(r, "member"));
}
