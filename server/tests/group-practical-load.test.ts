import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  CourseContentSchema,
  type GroupAssessment,
  type GroupFile,
} from "@eks/contracts";
import { canonicalHash } from "../src/releases.ts";
import { groupSourceHash } from "../src/group-practical-evidence.ts";
import { groupPreview, executeGroup } from "../src/group-practical.ts";
import { seedOrganizations, userView } from "../src/organizations.ts";
import { JsonStore } from "../src/storage.ts";
import { groupSeed, groupNow } from "./group-practical-fixture.ts";

test(
  "그룹 실기 시험부하: 완료1000차수·진행20그룹·동시 평가자5명",
  { skip: process.env.EKS_GROUP_LOAD_TEST !== "1", timeout: 120000 },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "eks-group-load-")),
      file = path.join(dir, "runtime/state.json"),
      initial = new JsonStore(file),
      s = groupSeed(),
      doc = seedOrganizations();
    const raw = await initial.groupFiles.save(
      (async function* () {
        yield Buffer.from("person,trial,value\na,1,1");
      })(),
      "raw.csv",
      "raw",
    );
    const report = await initial.groupFiles.save(
      (async function* () {
        yield Buffer.from("%PDF-1.4\nload report");
      })(),
      "report.pdf",
      "report",
    );
    const course = s.courses.find((c) => c.id === "demo-course-1")!,
      hash = canonicalHash(CourseContentSchema.parse(course)),
      proto = s.assignments[0]!;
    for (let i = 1; i < 5; i++)
      s.users.push({
        ...structuredClone(s.users.find((u) => u.id === "admin-1")!),
        id: `load-admin-${i}`,
      });
    for (let i = 0; i < 1020; i++) {
      const active = i >= 1000,
        evaluatorId = i % 5 === 0 ? "admin-1" : `load-admin-${i % 5}`;
      const members = s.assignments.slice(0, 3).map((a, j) => {
        let learnerId = a.learnerId,
          enrollmentId = `${a.id}:demo-course-1`;
        if (active) {
          learnerId = `load-user-${i}-${j}`;
          s.users.push({
            ...structuredClone(s.users.find((u) => u.id === a.learnerId)!),
            id: learnerId,
          });
          const assignmentId = `load-assignment-${i}-${j}`;
          s.assignments.push({
            ...structuredClone(proto),
            id: assignmentId,
            learnerId,
          });
          enrollmentId = `${assignmentId}:demo-course-1`;
          s.enrollments.push({
            id: enrollmentId,
            assignmentId,
            courseId: course.id,
          });
        }
        return { learnerId, enrollmentId, name: `구성원 ${j + 1}` };
      });
      const g: GroupAssessment = {
        id: `group-${i}`,
        title: `부하 그룹 ${i}`,
        lv1OrganizationId: "org-photo",
        courseId: course.id,
        evaluatorId,
        revision: 1,
        status: active ? "active" : "closed",
        members,
        createdBy: "admin-1",
        createdAt: groupNow,
        startedAt: groupNow,
        courseHash: hash,
        environment: "trial",
        ...(!active
          ? { closed: { by: "admin-1", at: groupNow, reason: "완료 이력" } }
          : {}),
        runs: [
          {
            id: `run-${i}`,
            number: 1,
            revision: 1,
            status: active ? "reviewing" : "failed",
            createdAt: groupNow,
            previousAnalyses: [],
            trials: members.flatMap((m) =>
              [1, 2, 3].map((number) => ({
                learnerId: m.learnerId,
                number,
                revision: 1,
                performedOn: "2026-11-10",
                evidence: [
                  { fileId: `raw-${i}`, locator: `${m.learnerId}:${number}` },
                ],
                note: "",
                completed: true,
                updatedBy: evaluatorId,
                updatedAt: groupNow,
              })),
            ),
          },
        ],
      };
      for (const [kind, stored] of [
        ["raw", raw],
        ["report", report],
      ] as const)
        s.groupAssessmentFiles.push({
          id: `${kind}-${i}`,
          groupId: g.id,
          runId: g.runs[0]!.id,
          kind,
          ...stored,
          uploadedBy: evaluatorId,
          uploadedAt: groupNow,
        } as GroupFile);
      const r = g.runs[0]!;
      r.analysis = {
        sourceHash: groupSourceHash(s, g, r),
        values: { variation: 4 },
        reportFileIds: [`report-${i}`],
        reason: "분석 대조",
        result: active ? "passed" : "failed",
        dataVerified: true,
        registeredBy: evaluatorId,
        registeredAt: groupNow,
      };
      if (!active)
        r.decision = {
          id: `decision-${i}`,
          result: "failed",
          decidedBy: evaluatorId,
          decidedAt: groupNow,
          sourceHash: r.analysis.sourceHash,
          analysisHash: canonicalHash(r.analysis),
        };
      s.groupAssessments.push(g);
    }
    await initial.initialize(s);
    const store = await new JsonStore(file).load();
    t.after(async () => {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    });
    const reads: number[] = [],
      writes: number[] = [];
    // Each wave models five independently assigned evaluators, including time queued behind other writes.
    for (let wave = 0; wave < 4; wave++) {
      const tasks = Array.from(
        { length: 5 },
        (_, j) => `group-${1000 + wave * 5 + j}`,
      );
      await Promise.all(
        tasks.map(async (id) => {
          let start = performance.now();
          const preview = await store.consistent((state, org) => {
            const g = state.groupAssessments.find((g) => g.id === id)!;
            return groupPreview(state, org, g, g.runs[0]!);
          });
          reads.push(performance.now() - start);
          assert.deepEqual(preview.blockers, []);
          const snapshot = store.snapshot(),
            g = snapshot.groupAssessments.find((g) => g.id === id)!,
            run = g.runs[0]!;
          start = performance.now();
          await store.transact(
            g.evaluatorId,
            randomUUID(),
            id,
            () => {},
            (state) =>
              executeGroup(
                state,
                doc,
                userView(
                  state.users.find((u) => u.id === g.evaluatorId)!,
                  doc,
                ),
                "finalize",
                id,
                run.id,
                { revision: run.revision, reviewToken: preview.token },
                groupNow,
              ),
          );
          writes.push(performance.now() - start);
        }),
      );
    }
    const p95 = (v: number[]) =>
      [...v].sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1]!;
    t.diagnostic(
      JSON.stringify({
        completedRuns: 1000,
        activeGroups: 20,
        concurrentEvaluators: 5,
        readP95Ms: Math.round(p95(reads)),
        finalizeP95Ms: Math.round(p95(writes)),
        metadataBytes: Buffer.byteLength(JSON.stringify(s)),
        measurement:
          "queries + queued atomic finalization, small shared evidence files; full autosave cost included",
      }),
    );
    assert(p95(reads) < 1000, "조회 p95 1초");
    assert(p95(writes) < 2000, "확정 p95 2초");
    assert.equal(store.snapshot().completions.length, 60);
  },
);
