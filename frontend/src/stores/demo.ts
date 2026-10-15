import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import initial from '../data/demo.json';
import type {
  Assignment,
  Course,
  DemoState,
  Enrollment,
  Kind,
  Qualification,
  Verdict,
} from '../types';

// Interaction prototype only. Replace this adapter with the approved server API.
// Fictional answers here are public demo fixtures, not a secure assessment service.
export const useDemo = defineStore('demo', () => {
  const data = ref<DemoState>(structuredClone(initial) as DemoState);
  const actorId = ref('learner-1');
  const actor = computed(() => data.value.users.find((user) => user.id === actorId.value)!);
  const toast = ref('');
  let toastTimer: ReturnType<typeof setTimeout>;
  const myAssignments = computed(() =>
    data.value.assignments.filter((a) => a.learnerId === actorId.value && !a.excludedReason),
  );
  const ftAssignments = computed(() =>
    data.value.assignments.filter(
      (a) => a.ftId === actorId.value && a.learnerId !== actorId.value && !a.excludedReason,
    ),
  );
  const notices = computed(() =>
    data.value.notices.filter((n) => n.published).sort((a, b) => b.date.localeCompare(a.date)),
  );
  function notify(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ''), 4000);
  }
  function qualification(id: string) {
    return data.value.qualifications.find((q) => q.id === id)!;
  }
  function course(id: string) {
    return data.value.courses.find((c) => c.id === id)!;
  }
  function assignment(id: string) {
    return data.value.assignments.find((a) => a.id === id);
  }
  function requiredKinds(c: Course): Kind[] {
    return c.mode === 'both' ? ['objective', 'practical'] : [c.mode];
  }
  function complete(enrollment: Enrollment) {
    return requiredKinds(course(enrollment.courseId)).every(
      (kind) => enrollment[kind] === 'passed',
    );
  }
  function completedCount(a: Assignment) {
    return a.enrollments.filter(complete).length;
  }
  function assessmentCount(a: Assignment) {
    return a.enrollments.reduce((n, e) => n + requiredKinds(course(e.courseId)).length, 0);
  }
  function passedCount(a: Assignment) {
    return a.enrollments.reduce(
      (n, e) => n + requiredKinds(course(e.courseId)).filter((k) => e[k] === 'passed').length,
      0,
    );
  }
  function username(id: string) {
    return data.value.users.find((u) => u.id === id)?.name ?? '미지정';
  }
  function switchActor(id: string) {
    actorId.value = id;
    toast.value = '';
  }
  function certify(a: Assignment) {
    if (!a.excludedReason && a.enrollments.length && a.enrollments.every(complete))
      a.certifiedAt ??= new Date().toISOString();
  }
  function enrollmentFor(aid: string, cid: string) {
    return assignment(aid)?.enrollments.find((e) => e.courseId === cid);
  }
  function editableAssignment(aid: string, role: 'learner' | 'ft') {
    const a = assignment(aid);
    if (
      !a ||
      a.excludedReason ||
      actor.value.role !== role ||
      (role === 'learner'
        ? a.learnerId !== actorId.value
        : a.ftId !== actorId.value || a.learnerId === actorId.value)
    )
      throw new Error('처리할 수 없는 평가입니다.');
    return a;
  }
  function saveAnswer(aid: string, cid: string, qid: string, value: number) {
    editableAssignment(aid, 'learner');
    const e = enrollmentFor(aid, cid)!;
    if (e.objective === 'passed') return;
    e.answers[qid] = value;
    e.objective = 'draft';
  }
  function submitObjective(aid: string, cid: string) {
    const a = editableAssignment(aid, 'learner'),
      e = enrollmentFor(aid, cid)!,
      c = course(cid);
    if (e.objective === 'passed' || !requiredKinds(c).includes('objective')) return;
    if (c.questions.some((q) => e.answers[q.id] === undefined))
      throw new Error('모든 문항에 답해 주세요.');
    const total = c.questions.reduce((n, q) => n + q.points, 0);
    const earned = c.questions.reduce(
      (n, q) => n + (e.answers[q.id] === q.correct ? q.points : 0),
      0,
    );
    e.objective = earned * 100 >= total * (c.passScore ?? 100) ? 'passed' : 'failed';
    e.history.push({
      id: crypto.randomUUID(),
      kind: 'objective',
      round: e.history.filter((h) => h.kind === 'objective').length + 1,
      result: e.objective,
      date: new Date().toISOString(),
      answers: { ...e.answers },
    });
    e.answers = {};
    certify(a);
    return e.objective;
  }
  function requestPractical(aid: string, cid: string) {
    editableAssignment(aid, 'learner');
    const e = enrollmentFor(aid, cid)!;
    if (
      !requiredKinds(course(cid)).includes('practical') ||
      ['waiting', 'passed'].includes(e.practical)
    )
      return;
    e.practical = 'waiting';
    e.verdicts = {};
    notify('실기 평가를 요청했습니다.');
  }
  function saveVerdict(aid: string, cid: string, id: string, verdict: Verdict) {
    editableAssignment(aid, 'ft');
    const e = enrollmentFor(aid, cid)!;
    if (e.practical !== 'waiting') return;
    e.verdicts[id] = { ...verdict };
  }
  function evaluate(aid: string, cid: string) {
    const a = editableAssignment(aid, 'ft'),
      e = enrollmentFor(aid, cid)!,
      c = course(cid);
    if (e.practical !== 'waiting') return;
    if (
      c.practicalItems.some((i) => !e.verdicts[i.id]?.value || !e.verdicts[i.id]?.evidence.trim())
    )
      throw new Error('각 항목의 판정과 근거를 입력해 주세요.');
    e.practical = c.practicalItems
      .filter((i) => i.mandatory)
      .every((i) => e.verdicts[i.id]?.value === 'pass')
      ? 'passed'
      : 'failed';
    e.history.push({
      id: crypto.randomUUID(),
      kind: 'practical',
      round: e.history.filter((h) => h.kind === 'practical').length + 1,
      result: e.practical,
      date: new Date().toISOString(),
      verdicts: JSON.parse(JSON.stringify(e.verdicts)),
    });
    certify(a);
    notify('평가를 확정했습니다.');
  }
  function addAssignment(qid: string, learnerId: string, ftId: string) {
    if (actor.value.role !== 'admin') throw new Error('관리자만 배정할 수 있습니다.');
    const q = qualification(qid);
    if (
      q.status !== 'published' ||
      !q.courseIds.length ||
      q.courseIds.some((cid) => course(cid)?.status !== 'published')
    )
      throw new Error('사용 중인 자격을 선택해 주세요.');
    if (
      !data.value.users.some((u) => u.id === learnerId && u.role === 'learner') ||
      !data.value.users.some((u) => u.id === ftId && u.role === 'ft') ||
      learnerId === ftId
    )
      throw new Error('대상자와 FT를 확인해 주세요.');
    if (
      data.value.assignments.some(
        (a) => a.learnerId === learnerId && a.qualificationId === qid && !a.excludedReason,
      )
    )
      throw new Error('이미 배정된 자격입니다.');
    data.value.assignments.push({
      id: crypto.randomUUID(),
      qualificationId: qid,
      learnerId,
      ftId,
      assignedAt: new Date().toISOString().slice(0, 10),
      enrollments: q.courseIds.map((courseId) => ({
        courseId,
        objective: 'ready',
        practical: 'ready',
        answers: {},
        verdicts: {},
        history: [],
      })),
    });
    notify('자격을 배정했습니다.');
  }
  function courseErrors(c: Course) {
    const errors: string[] = [];
    if (!c.title.trim()) errors.push('과정명을 입력해 주세요.');
    if (requiredKinds(c).includes('objective')) {
      if (!c.passScore || !Number.isInteger(c.passScore) || c.passScore < 1 || c.passScore > 100)
        errors.push('객관식 합격 기준을 1~100으로 입력해 주세요.');
      if (!c.questions.length) errors.push('객관식 문항을 추가해 주세요.');
      c.questions.forEach((q, i) => {
        if (
          !q.prompt.trim() ||
          q.choices.length < 2 ||
          q.choices.some((v) => !v.trim()) ||
          q.correct === null ||
          !q.choices[q.correct] ||
          !Number.isInteger(q.points) ||
          q.points <= 0
        )
          errors.push(`객관식 ${i + 1}번의 문항·선택지·정답·배점을 확인해 주세요.`);
      });
    }
    if (requiredKinds(c).includes('practical')) {
      if (!c.practicalItems.some((i) => i.mandatory))
        errors.push('필수 실기 항목을 추가해 주세요.');
      if (c.practicalItems.some((i) => !i.title.trim() || !i.criterion.trim()))
        errors.push('실기 항목과 판정 기준을 입력해 주세요.');
    }
    return errors;
  }
  function qualificationErrors(q: Qualification) {
    const errors: string[] = [];
    if (!q.title.trim()) errors.push('자격명을 입력해 주세요.');
    if (!q.courseIds.length) errors.push('필수 과정을 선택해 주세요.');
    if (q.courseIds.some((id) => course(id)?.status !== 'published'))
      errors.push('필수 과정을 먼저 사용 등록해 주세요.');
    return errors;
  }
  return {
    data,
    actor,
    actorId,
    toast,
    myAssignments,
    ftAssignments,
    notices,
    notify,
    qualification,
    course,
    assignment,
    enrollmentFor,
    requiredKinds,
    complete,
    completedCount,
    assessmentCount,
    passedCount,
    username,
    switchActor,
    saveAnswer,
    submitObjective,
    requestPractical,
    saveVerdict,
    evaluate,
    addAssignment,
    courseErrors,
    qualificationErrors,
  };
});
