import { courseUseErrors, type Course, type Kind } from '@eks/contracts';
export interface CourseIssue {
  kind: Kind | 'basic' | 'learning';
  itemId?: string;
  field: string;
  message: string;
}
// Presentation locations supplement the shared publication rules; server validation remains authoritative.
export function courseIssues(c: Course): CourseIssue[] {
  const issues: CourseIssue[] = [];
  const add = (kind: CourseIssue['kind'], field: string, message: string, itemId?: string) =>
    issues.push({ kind, field, message, itemId });
  if (!c.title.trim()) add('basic', 'title', '과정명을 입력해 주세요.');
  if (!c.assessmentKinds.length) add('basic', 'assessmentKinds', '필수 평가 유형을 선택해 주세요.');
  c.learningItems.forEach((i, n) => {
    if (!i.title.trim())
      add('learning', 'title', `학습 항목 ${n + 1}번의 이름을 입력해 주세요.`, i.id);
  });
  if (!c.learningItems.some((i) => i.required))
    add(
      'learning',
      'required',
      '필수 학습 항목을 하나 이상 설정해 주세요.',
      c.learningItems[0]?.id,
    );
  for (const kind of ['objective', 'subjective', 'practical'] as Kind[]) {
    if (!c.assessmentKinds.includes(kind)) continue;
    const label = { objective: '객관식', subjective: '주관식', practical: '실기' }[kind];
    if (kind !== 'practical') {
      const score = kind === 'objective' ? c.passScore : c.subjectivePassScore;
      if (!Number.isInteger(score) || !score || score < 1 || score > 100)
        add(kind, 'passScore', `${label} 합격 기준을 1~100으로 입력해 주세요.`);
    }
    const items =
      kind === 'objective'
        ? c.questions
        : kind === 'subjective'
          ? c.subjectiveQuestions
          : c.practicalItems;
    if (!items.length)
      add(kind, 'add', `${label} ${kind === 'practical' ? '항목' : '문항'}을 추가해 주세요.`);
    items.forEach((q, n) => {
      const prefix = `${label} ${n + 1}번`;
      if ('prompt' in q) {
        if (!q.prompt.trim()) add(kind, 'prompt', `${prefix} 문항을 입력해 주세요.`, q.id);
        if (!Number.isInteger(q.points) || q.points < 1)
          add(kind, 'points', `${prefix} 배점을 1 이상의 정수로 입력해 주세요.`, q.id);
      }
      if ('choices' in q) {
        if (q.choices.length < 2)
          add(kind, 'choices', `${prefix} 선택지는 두 개 이상 필요합니다.`, q.id);
        q.choices.forEach((v, i) => {
          if (!v.trim())
            add(kind, `choice${i + 1}`, `${prefix} ${i + 1}번 선택지를 입력해 주세요.`, q.id);
        });
        if (q.correct == null || !q.choices[q.correct]?.trim())
          add(kind, 'correct', `${prefix} 정답을 선택해 주세요.`, q.id);
      }
      if ('rubric' in q && !q.rubric?.trim())
        add(kind, 'rubric', `${prefix} 채점 기준을 입력해 주세요.`, q.id);
      if ('criterion' in q) {
        if (!q.title.trim()) add(kind, 'title', `${prefix} 항목명을 입력해 주세요.`, q.id);
        if (!q.criterion.trim())
          add(kind, 'criterion', `${prefix} 관찰·판정 기준을 입력해 주세요.`, q.id);
      }
    });
    if (kind === 'practical' && items.length && !c.practicalItems.some((i) => i.mandatory))
      add(kind, 'mandatory', '필수 실기 항목을 지정해 주세요.', items[0]?.id);
  }
  // Non-field integrity failures (e.g. duplicate imported IDs) stay visible as a summary.
  for (const message of courseUseErrors(c).filter((m) => m.includes('식별자'))) {
    if (message.includes('학습') && c.learningItems.some((i) => !i.title.trim())) continue;
    add('basic', 'title', message);
  }
  return issues;
}
