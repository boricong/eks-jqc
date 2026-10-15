export type Role = 'learner' | 'ft' | 'admin';
export type AssessmentState = 'ready' | 'draft' | 'waiting' | 'passed' | 'failed';
export type Kind = 'objective' | 'practical';
export interface User {
  id: string;
  name: string;
  role: Role;
}
export interface Question {
  id: string;
  prompt: string;
  choices: string[];
  correct: number | null;
  points: number;
}
export interface PracticalItem {
  id: string;
  title: string;
  criterion: string;
  mandatory: boolean;
}
export interface Course {
  id: string;
  title: string;
  version: number;
  status: 'draft' | 'published';
  mode: 'both' | Kind;
  passScore: number | null;
  material: string;
  questions: Question[];
  practicalItems: PracticalItem[];
  instruction: string;
}
export interface Qualification {
  id: string;
  title: string;
  version: number;
  status: 'draft' | 'published';
  courseIds: string[];
}
export interface Verdict {
  value: 'pass' | 'fail' | '';
  evidence: string;
}
export interface Attempt {
  id: string;
  kind: Kind;
  round: number;
  result: 'passed' | 'failed';
  date: string;
  answers?: Record<string, number>;
  verdicts?: Record<string, Verdict>;
}
export interface Enrollment {
  courseId: string;
  objective: AssessmentState;
  practical: AssessmentState;
  answers: Record<string, number>;
  verdicts: Record<string, Verdict>;
  history: Attempt[];
}
export interface Assignment {
  id: string;
  qualificationId: string;
  learnerId: string;
  ftId: string;
  assignedAt: string;
  excludedReason?: string;
  certifiedAt?: string;
  enrollments: Enrollment[];
}
export interface Notice {
  id: string;
  title: string;
  body: string;
  date: string;
  published: boolean;
}
export interface DemoState {
  users: User[];
  qualifications: Qualification[];
  courses: Course[];
  assignments: Assignment[];
  notices: Notice[];
}
