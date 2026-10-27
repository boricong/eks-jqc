/** Reconstruct pre-v25 plan payloads for historical migration fixtures only. */
export function legacyPlanFixture(s: any) {
  for (const r of [
    ...(s.plans || []),
    ...(s.assignments || []),
    ...(s.certifications || []),
    ...(s.renewals || []),
  ]) {
    delete r.frozenCriteria;
    for (const p of r.periods || []) delete p.frozenCriteria;
  }
  for (const p of s.plans || []) {
    if (!Object.hasOwn(p, "startOn")) continue;
    const ids = s.qualifications.find(
      (q: any) => q.id === p.qualificationId,
    ).courseIds;
    p.targetOn = p.endOn;
    p.schedules = ids.map((courseId: string) => ({
      courseId,
      learningStart: p.startOn,
      learningEnd: p.endOn,
      assessmentOn: p.endOn,
      goal: p.goal,
    }));
    p.workflowVersion = "personal-certification-v5";
    delete p.startOn;
    delete p.endOn;
    delete p.goal;
    delete p.previousSchedule;
  }
}
