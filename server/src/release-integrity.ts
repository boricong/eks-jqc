import { CourseContentSchema, type State } from "@eks/contracts";
import { canonicalHash, qualificationHash } from "./releases.ts";

export function validateReleases(s: State) {
  const check = (v: unknown, message: string) => {
    if (!v) throw Error("버전 무결성 오류: " + message);
  };
  const releases = new Map(s.commonCourseReleases.map((r) => [r.id, r]));
  check(releases.size === s.commonCourseReleases.length, "공통 버전 ID 중복");
  for (const c of s.commonCourses)
    if (c.headReleaseId) {
      const r = releases.get(c.headReleaseId);
      check(r?.commonCourseId === c.id, "공통 현재 버전 참조");
      check(
        canonicalHash(CourseContentSchema.parse(c)) ===
          canonicalHash(CourseContentSchema.parse(r)),
        "공통 현재 내용과 버전 불일치",
      );
    }
  for (const c of s.courses)
    if (c.commonCourseSource?.releaseId) {
      const r = releases.get(c.commonCourseSource.releaseId);
      check(
        r?.commonCourseId === c.commonCourseSource.id,
        "팀 사본 원본 버전 참조",
      );
    }
  for (const u of s.commonUpdates) {
    check(
      releases.get(u.sourceReleaseId)?.commonCourseId === u.commonCourseId,
      "공통 보류 원본 참조",
    );
    check(
      s.courses.some(
        (c) =>
          c.entityId === u.courseEntityId && c.lv1OrganizationId === u.teamId,
      ),
      "공통 보류 팀 참조",
    );
  }
  for (const record of [
    ...s.assignments,
    ...s.plans,
    ...s.certifications,
    ...s.renewals,
  ]) {
    const frozen = record.frozenCriteria;
    if (!frozen) continue;
    const q = s.qualifications.find((q) => q.id === frozen.qualificationId);
    check(q && record.qualificationId === q.id, "확정 자격 참조");
    for (const entry of frozen.courses) {
      const c = s.courses.find((c) => c.id === entry.id);
      check(c && c.entityId === entry.entityId, "확정 인증Set 참조");
      if (frozen.source !== "migration")
        check(
          canonicalHash(CourseContentSchema.parse(c)) === entry.hash,
          "확정 인증Set 내용 변경",
        );
    }
    if (frozen.source !== "migration")
      check(
        q && qualificationHash(q) === frozen.qualificationHash,
        "확정 자격 내용 변경",
      );
  }
}
