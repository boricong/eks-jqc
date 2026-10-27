import { courseUseErrors, type CourseContent, type Kind } from '@eks/contracts';
export interface CourseIssue {
  kind: Kind | 'basic' | 'learning' | 'materials';
  itemId?: string;
  field: string;
  message: string;
}
export function materialUrlIssue(
  material: CourseContent['materials'][number],
): CourseIssue | undefined {
  if (material.type === 'text' || !material.url) return;
  try {
    if (['http:', 'https:'].includes(new URL(material.url).protocol)) return;
  } catch {
    /* Report invalid URLs at their field without losing the draft. */
  }
  return {
    kind: 'materials',
    itemId: material.id,
    field: 'url',
    message: '자료의 URL을 HTTP(S) 주소로 입력해 주세요.',
  };
}
// Presentation locations supplement the shared publication rules; server validation remains authoritative.
export function courseIssues(c: CourseContent): CourseIssue[] {
  const issues: CourseIssue[] = [];
  const add = (kind: CourseIssue['kind'], field: string, message: string, itemId?: string) =>
    issues.push({ kind, field, message, itemId });
  if (!c.title.trim()) add('basic', 'title', '인증Set명을 입력해 주세요.');
  if (c.qualificationType !== 'auditor' && !c.assessmentKinds.length)
    add('basic', 'assessmentKinds', '필수 평가 유형을 선택해 주세요.');
  if (
    c.qualificationType !== 'auditor' &&
    c.assessmentKinds.includes('practical') &&
    !c.assessmentKinds.includes('objective')
  )
    add(
      'basic',
      'assessmentKinds',
      '상황 대응 평가를 사용하려면 지식 평가도 필수로 설정해 주세요.',
    );
  c.materials.forEach((m, n) => {
    if (!m.title.trim())
      add('materials', 'title', `학습 정보 · 자료 ${n + 1}번의 자료명을 입력해 주세요.`, m.id);
    if (m.type === 'text' && !m.content.trim())
      add('materials', 'content', `학습 정보 · 자료 ${n + 1}번의 본문을 입력해 주세요.`, m.id);
    if (m.type !== 'text' && !m.url)
      add('materials', 'url', `학습 정보 · 자료 ${n + 1}번의 URL을 입력해 주세요.`, m.id);
    const urlIssue = materialUrlIssue(m);
    if (urlIssue) issues.push(urlIssue);
  });
  c.learningItems.forEach((i, n) => {
    if (!i.title.trim())
      add('learning', 'title', `학습 정보 · 교육 ${n + 1}번의 이름을 입력해 주세요.`, i.id);
  });
  if (c.qualificationType === 'auditor' && !c.learningItems.some((i) => i.required))
    add(
      'learning',
      'required',
      '운영하려면 필수 교육을 하나 이상 설정해 주세요.',
      c.learningItems[0]?.id,
    );
  for (const kind of ['objective', 'practical'] as Kind[]) {
    if (c.qualificationType === 'auditor' || !c.assessmentKinds.includes(kind)) continue;
    const label = { objective: '지식 평가', practical: '상황 대응 평가' }[kind];
    {
      const score = kind === 'objective' ? c.passScore : c.practicalPassScore;
      if (!Number.isInteger(score) || !score || score < 1 || score > 100)
        add(kind, 'passScore', `${label} 합격 기준을 1~100으로 입력해 주세요.`);
    }
    const items = kind === 'objective' ? c.questions : c.practicalQuestions;
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
      if ('scenario' in q && !String(q.scenario).trim())
        add(kind, 'scenario', `${prefix} 상황 설명을 입력해 주세요.`, q.id);
    });
  }
  // Non-field integrity failures (e.g. duplicate imported IDs) stay visible as a summary.
  for (const message of courseUseErrors(c).filter((m) => m.includes('식별자'))) {
    if (message.includes('학습') && c.learningItems.some((i) => !i.title.trim())) continue;
    add('basic', 'title', message);
  }
  return issues;
}
