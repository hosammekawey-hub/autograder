export interface Student {
  id: string;
  name: string;
  studentId: string;
  solutionFile: File | null;
  grade: string | null;
  justification: string | null;
  feedback: string | null;
  status: 'idle' | 'grading' | 'graded' | 'error';
}
