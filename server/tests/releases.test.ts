import test from "node:test";
import assert from "node:assert/strict";
import {
  CourseContentSchema,
  latestQualification,
  courseUseErrors,
} from "@eks/contracts";
import { seedState } from "../src/seed.ts";
import { seedOrganizations } from "../src/organizations.ts";
import { prepareCatalogSave, saveCatalogItem } from "../src/catalog-editing.ts";
import {
  courseChange,
  courseRelease,
  latestCourse,
  resolveCommonUpdate,
  freezeCriteria,
} from "../src/releases.ts";
import { saveCommonCourse, copyCommonCourses } from "../src/common-courses.ts";
import { saveTemplate } from "../src/qualification-templates.ts";
import { migrateReleases } from "../src/release-migration.ts";
import {
  exportMaster,
  readMaster,
  masterCandidate,
} from "./legacy-master-data.ts";

test("인증Set 초안은 v0.x이며 최초 준비 완료만 v1.0, 보완 전후는 문항 변경도 마이너다", () => {
  const s = seedState(true),
    complete = s.courses[0]!;
  const draft: typeof complete = {
    ...structuredClone(complete),
    questions: [],
    releaseVersion: { major: 0, minor: 1 },
  };
  assert.deepEqual(courseRelease(undefined, draft).releaseVersion, {
    major: 0,
    minor: 1,
  });
  const changed = { ...draft, title: "초안 변경" };
  assert.deepEqual(courseRelease(draft, changed).releaseVersion, {
    major: 0,
    minor: 2,
  });
  const partial = structuredClone(draft);
  partial.questions = structuredClone(complete.questions);
  partial.questions[0]!.correct = null;
  assert.equal(courseRelease(draft, partial).kind, "minor");
  assert.deepEqual(courseRelease(partial, complete).releaseVersion, {
    major: 1,
    minor: 0,
  });
  const v2 = { ...complete, releaseVersion: { major: 2, minor: 4 } };
  const incomplete = { ...structuredClone(v2), passScore: null };
  assert.deepEqual(courseRelease(v2, incomplete).releaseVersion, {
    major: 2,
    minor: 5,
  });
  incomplete.releaseVersion = { major: 2, minor: 5 };
  const recovered = structuredClone(v2);
  recovered.questions[0]!.prompt += " 수정";
  assert.deepEqual(courseRelease(incomplete, recovered).releaseVersion, {
    major: 2,
    minor: 6,
  });
  assert.deepEqual(courseRelease(v2, recovered).releaseVersion, {
    major: 3,
    minor: 0,
  });
  assert.equal(courseRelease(v2, structuredClone(v2)).kind, "none");
  const auditor = CourseContentSchema.parse({
    ...complete,
    qualificationType: "auditor",
    learningItems: [],
    assessmentKinds: [],
    questions: [],
    practicalQuestions: [],
    passScore: null,
    practicalPassScore: null,
    subjectiveEnabled: false,
    subjectiveQuestions: [],
  });
  assert.deepEqual(courseRelease(undefined, auditor).releaseVersion, {
    major: 0,
    minor: 1,
  });
  assert.deepEqual(
    courseRelease(
      { ...auditor, releaseVersion: { major: 0, minor: 3 } },
      {
        ...auditor,
        learningItems: [
          { id: "training", type: "mtc", title: "필수 교육", required: true },
        ],
      },
    ).releaseVersion,
    { major: 1, minor: 0 },
  );
});

test("공통 원본의 초안·최초 완성·보완과 팀 사본 전파는 버전과 과거 내용을 보존한다", () => {
  const s = seedState(true),
    complete = CourseContentSchema.parse(s.courses[0]);
  const first = saveCommonCourse(s, "operator-1", undefined, {
    ...complete,
    questions: [],
  });
  assert.deepEqual(first.releaseVersion, { major: 0, minor: 1 });
  assert.throws(() => copyCommonCourses(s, [first.id], "org-photo"), /완성된/);
  let head = saveCommonCourse(s, "operator-1", first.id, {
    ...complete,
    questions: [],
    title: "초안 변경",
    revision: first.revision,
  });
  assert.deepEqual(head.releaseVersion, { major: 0, minor: 2 });
  head = saveCommonCourse(s, "operator-1", first.id, {
    ...complete,
    revision: head.revision,
  });
  assert.deepEqual(head.releaseVersion, { major: 1, minor: 0 });
  const copy = structuredClone(
    copyCommonCourses(s, [head.id], "org-photo")[0]!,
  );
  assert.deepEqual(copy.releaseVersion, { major: 1, minor: 0 });
  const questions = structuredClone(complete.questions);
  questions[0]!.prompt += "미완성 개정";
  head = saveCommonCourse(s, "operator-1", first.id, {
    ...complete,
    questions,
    passScore: null,
    revision: head.revision,
  });
  assert.deepEqual(head.releaseVersion, { major: 1, minor: 1 });
  assert.equal(latestCourse(s, copy.entityId)!.id, copy.id);
  head = saveCommonCourse(s, "operator-1", first.id, {
    ...complete,
    questions,
    revision: head.revision,
  });
  assert.deepEqual(head.releaseVersion, { major: 1, minor: 2 });
  // A complete team copy compares against its own complete baseline.
  assert.deepEqual(latestCourse(s, copy.entityId)!.releaseVersion, {
    major: 2,
    minor: 0,
  });
  assert.deepEqual(
    s.courses.find((c) => c.id === copy.id),
    copy,
  );
  const count = s.commonCourseReleases.length;
  saveCommonCourse(s, "operator-1", first.id, {
    ...complete,
    questions,
    revision: head.revision,
  });
  assert.equal(s.commonCourseReleases.length, count);
  assert.deepEqual(
    s.commonCourseReleases
      .filter((r) => r.commonCourseId === first.id)
      .map((r) => r.releaseVersion),
    [
      { major: 0, minor: 1 },
      { major: 0, minor: 2 },
      { major: 1, minor: 0 },
      { major: 1, minor: 1 },
      { major: 1, minor: 2 },
    ],
  );
});

test("문항 비교는 ID를 제외하고 채점 문항의 모든 변화만 메이저로 판정한다", () => {
  const c = seedState(true).courses[0]!;
  const cases: [string, (n: typeof c) => void, "none" | "minor" | "major"][] = [
    [
      "ID",
      (n) => {
        n.questions[0]!.id = "other";
      },
      "none",
    ],
    [
      "문항",
      (n) => {
        n.questions[0]!.prompt += " 변경";
      },
      "major",
    ],
    [
      "정답",
      (n) => {
        n.questions[0]!.correct = 1;
      },
      "major",
    ],
    [
      "배점",
      (n) => {
        n.questions[0]!.points++;
      },
      "major",
    ],
    [
      "선택지",
      (n) => {
        n.questions[0]!.choices.reverse();
      },
      "major",
    ],
    [
      "삭제",
      (n) => {
        n.questions.pop();
      },
      "major",
    ],
    [
      "주관식",
      (n) => {
        n.subjectiveQuestions.push({ id: "s", prompt: "설명" });
      },
      "minor",
    ],
    [
      "교육",
      (n) => {
        n.learningItems = [];
      },
      "minor",
    ],
    [
      "합격 기준",
      (n) => {
        n.passScore = 51;
      },
      "minor",
    ],
    [
      "평가 사용",
      (n) => {
        n.assessmentKinds = [];
      },
      "minor",
    ],
  ];
  for (const [name, edit, expected] of cases) {
    const n = structuredClone(c);
    edit(n);
    assert.equal(courseChange(c, n), expected, name);
  }
});

test("모든 변경 저장은 불변 버전이며 완성 인증Set만 자격 마이너로 자동 반영한다", () => {
  const s = seedState(true),
    org = seedOrganizations(),
    old = structuredClone(s.courses[0]!),
    q = structuredClone(s.qualifications[0]!);
  const save = (course: typeof old) =>
    saveCatalogItem(
      s,
      org,
      "courses",
      course.id,
      course,
      course.lv1OrganizationId,
      "admin-1",
    );
  const draft = { ...structuredClone(old), title: "새 이름" };
  const preview = prepareCatalogSave(
    s,
    org,
    "courses",
    old.id,
    draft,
    old.lv1OrganizationId,
  );
  assert.equal(preview.releaseChange?.after, "v1.1");
  assert.deepEqual(preview.propagation?.updated[0]?.releaseVersion, {
    major: 1,
    minor: 1,
  });
  const first = save(draft);
  assert.notEqual(first.id, old.id);
  assert.deepEqual(
    s.courses.find((c) => c.id === old.id),
    old,
  );
  let current = latestQualification(s, q.lv1OrganizationId, q.entityId)!;
  assert.deepEqual(current.releaseVersion, { major: 1, minor: 1 });
  assert.deepEqual(
    s.qualifications.find((x) => x.id === q.id),
    q,
  );
  const c = structuredClone(latestCourse(s, old.entityId)!);
  c.questions[0]!.prompt = "";
  save(c);
  assert.equal(
    latestQualification(s, q.lv1OrganizationId, q.entityId)!.id,
    current.id,
  );
  const unfinished = structuredClone(latestCourse(s, old.entityId)!);
  assert.deepEqual(unfinished.releaseVersion, { major: 1, minor: 2 });
  unfinished.questions[0]!.prompt = "완성 문항";
  save(unfinished);
  current = latestQualification(s, q.lv1OrganizationId, q.entityId)!;
  assert.deepEqual(current.releaseVersion, { major: 1, minor: 2 });
  const head = latestCourse(s, old.entityId)!;
  const size = s.courses.length;
  save(structuredClone(head));
  assert.equal(s.courses.length, size);
  assert.throws(() => save({ ...old, title: "과거 수정" }), /과거 버전/);
  const changed = {
    ...structuredClone(current),
    courseIds: current.courseIds.slice(0, 1),
  };
  const result = saveCatalogItem(
    s,
    org,
    "qualifications",
    current.id,
    changed,
    current.lv1OrganizationId,
    "admin-1",
  );
  assert.deepEqual(result.releaseVersion, { major: 2, minor: 0 });
});

test("공통 원본은 팀 수정 없는 사본을 전파하고 수정한 사본은 비교 후 결정한다", () => {
  const s = seedState(true),
    content = CourseContentSchema.parse(s.courses[0]);
  const common = saveCommonCourse(s, "operator-1", undefined, content);
  const [plain, custom] = copyCommonCourses(
    s,
    [common.id, common.id],
    "org-photo",
  );
  s.qualifications[0]!.commonCourseEntityIds.push(
    plain!.entityId,
    custom!.entityId,
  );
  s.qualifications[0]!.courseIds = [plain!.id, custom!.id];
  custom!.title = "팀 수정";
  const next = saveCommonCourse(s, "operator-1", common.id, {
    ...content,
    title: "원본 변경",
    revision: common.revision,
  });
  assert.notEqual(latestCourse(s, plain!.entityId)!.id, plain!.id);
  assert.equal(latestCourse(s, custom!.entityId)!.title, "팀 수정");
  const pending = s.commonUpdates.find(
    (u) => u.courseEntityId === custom!.entityId,
  )!;
  assert.equal(pending.status, "pending");
  resolveCommonUpdate(s, pending.id, "admin-1", "org-photo", {
    decision: "keep",
    courseId: custom!.id,
    revision: custom!.revision,
    sourceReleaseId: pending.sourceReleaseId,
  });
  assert.equal(pending.status, "kept");
  assert.equal(latestCourse(s, custom!.entityId)!.title, "팀 수정");
  saveCommonCourse(s, "operator-1", common.id, {
    ...content,
    title: "다음 원본",
    revision: next.revision,
  });
  const second = s.commonUpdates.find(
    (u) => u.courseEntityId === custom!.entityId && u.status === "pending",
  )!;
  resolveCommonUpdate(s, second.id, "admin-1", "org-photo", {
    decision: "apply",
    courseId: custom!.id,
    revision: custom!.revision,
    sourceReleaseId: second.sourceReleaseId,
  });
  assert.equal(latestCourse(s, custom!.entityId)!.title, "다음 원본");
  assert.equal(second.status, "applied");
  const head = s.commonCourses[0]!;
  saveCommonCourse(s, "operator-1", head.id, {
    ...content,
    title: "미완성",
    questions: [],
    revision: head.revision,
  });
  const [copy] = copyCommonCourses(s, [head.id], "org-photo");
  assert.equal(copy!.title, "다음 원본");
  assert.equal(courseUseErrors(copy!).length, 0);
});

test("기본자격 변경은 새 자격 마이너를 만들고 과거 기준·발급 스냅샷을 보존한다", () => {
  const s = seedState(true),
    q = structuredClone(s.qualifications[0]!),
    frozen = freezeCriteria(s, q, "learner-1", "plan");
  const t = s.qualificationTemplates.find((t) => t.id === q.templateId)!;
  saveTemplate(s, "operator-1", t.id, {
    revision: t.revision,
    title: "변경 이름",
    englishName: t.englishName,
    description: t.description,
  });
  const head = latestQualification(s, q.lv1OrganizationId, q.entityId)!;
  assert.equal(head.title, "변경 이름");
  assert.deepEqual(head.releaseVersion, { major: 1, minor: 1 });
  assert.deepEqual(
    s.qualifications.find((x) => x.id === q.id),
    q,
  );
  assert.deepEqual(
    frozen,
    freezeCriteria(s, q, "learner-1", "plan", frozen.confirmedAt),
  );
});

test("명시 이관은 vN.0과 스냅샷을 보존하고 JSON 왕복·재실행은 안정적이다", () => {
  const s = seedState(true),
    org = seedOrganizations();
  s.schemaVersion = 25;
  for (const c of [...s.courses, ...s.qualifications]) {
    delete c.releaseVersion;
    delete c.releaseInfo;
  }
  const migrated = migrateReleases(s, org);
  assert.equal(migrated.state.schemaVersion, 28);
  assert.deepEqual(migrated.state.courses[0]!.releaseVersion, {
    major: 1,
    minor: 0,
  });
  assert.deepEqual(migrateReleases(migrated.state, org).state, migrated.state);
  const file = exportMaster(migrated.state, org, new Date().toISOString());
  const imported = readMaster(file);
  assert.equal(imported.formatVersion, 15);
  const restored = masterCandidate(imported.payload, 0, 0).state;
  assert.deepEqual(restored.courses, migrated.state.courses);
  assert.deepEqual(restored.qualifications, migrated.state.qualifications);
});
