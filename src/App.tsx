import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Plus, Trash2, ArrowLeft, BookOpen, Users, Play, RefreshCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

type Session = {
  id: string;
  name: string;
  assignment_filename: string;
  model_answer_filename?: string;
  course_materials: { url: string, filename: string }[];
  generic_instructions?: string;
  created_at: string;
};

type Student = {
  id: string;
  session_id: string;
  name: string;
  student_id: string;
  solution_filename: string;
  grade?: string;
  justification?: string;
  feedback?: string;
  status: 'idle' | 'grading' | 'graded' | 'error';
};

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create Session State
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null);
  const [modelAnswerFile, setModelAnswerFile] = useState<File | null>(null);
  const [courseMaterialsFiles, setCourseMaterialsFiles] = useState<FileList | null>(null);
  const [genericInstructions, setGenericInstructions] = useState('');
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);

  // Add Student State
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [solutionFile, setSolutionFile] = useState<File | null>(null);
  const [isSubmittingStudent, setIsSubmittingStudent] = useState(false);
  const [studentFeedbacks, setStudentFeedbacks] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (activeSession) {
      fetchStudents(activeSession.id);
    }
  }, [activeSession]);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (error) {
      console.error('Failed to fetch sessions', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStudents = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/students`);
      const data = await res.json();
      setStudents(data);
    } catch (error) {
      console.error('Failed to fetch students', error);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignmentFile || !sessionName) return;

    setIsSubmittingSession(true);
    const formData = new FormData();
    const sessionId = uuidv4();
    formData.append('id', sessionId);
    formData.append('name', sessionName);
    formData.append('assignment', assignmentFile);
    if (modelAnswerFile) formData.append('modelAnswer', modelAnswerFile);
    if (courseMaterialsFiles) {
      Array.from(courseMaterialsFiles).forEach(file => {
        formData.append('courseMaterials', file);
      });
    }
    formData.append('genericInstructions', genericInstructions);

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        await fetchSessions();
        setIsCreatingSession(false);
        // Reset form
        setSessionName('');
        setAssignmentFile(null);
        setModelAnswerFile(null);
        setCourseMaterialsFiles(null);
        setGenericInstructions('');
      } else {
        const data = await res.json();
        alert(`Failed to create session: ${data.details || data.error}`);
      }
    } catch (error) {
      alert('Network error while creating session.');
    } finally {
      setIsSubmittingSession(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !solutionFile) return;

    setIsSubmittingStudent(true);
    const formData = new FormData();
    formData.append('id', uuidv4());
    formData.append('name', studentName);
    formData.append('student_id', studentId);
    formData.append('solution', solutionFile);

    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/students`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        await fetchStudents(activeSession.id);
        setIsAddingStudent(false);
        setStudentName('');
        setStudentId('');
        setSolutionFile(null);
      } else {
        const data = await res.json();
        alert(`Failed to add student: ${data.details || data.error}`);
      }
    } catch (error) {
      alert('Network error while adding student.');
    } finally {
      setIsSubmittingStudent(false);
    }
  };

  const handleGradeStudent = async (studentId: string, feedback?: string) => {
    // Optimistic UI update
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: 'grading' } : s));

    try {
      const res = await fetch(`/api/students/${studentId}/grade`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setStudents(prev => prev.map(s => s.id === studentId ? {
          ...s,
          status: 'graded',
          grade: data.grade,
          justification: data.justification
        } : s));
      } else {
        alert(`Grading failed: ${data.details || data.error}`);
        setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: 'error' } : s));
      }
    } catch (error: any) {
      alert(`Grading failed: ${error.message}`);
      setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: 'error' } : s));
    }
  };

  const handleGradeAll = async (regradeAll: boolean = false, feedback?: string) => {
    if (!activeSession) return;
    const targetStudents = students.filter(s => regradeAll ? s.status !== 'grading' : (s.status === 'idle' || s.status === 'error'));
    if (targetStudents.length === 0) {
      alert("No students to process.");
      return;
    }

    setStudents(prev => prev.map(s => (regradeAll ? s.status !== 'grading' : (s.status === 'idle' || s.status === 'error')) ? { ...s, status: 'grading' } : s));

    try {
      const res = await fetch(`/api/sessions/${activeSession.id}/grade-all`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback, regradeAll })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await fetchStudents(activeSession.id);
      } else {
        alert(`Batch grading failed: ${data.details || data.error}`);
        setStudents(prev => prev.map(s => (s.status === 'grading') ? { ...s, status: 'error' } : s));
      }
    } catch (error: any) {
      alert(`Batch grading failed: ${error.message}`);
      setStudents(prev => prev.map(s => (s.status === 'grading') ? { ...s, status: 'error' } : s));
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    if (!confirm('Are you sure you want to delete this student?')) return;
    try {
      await fetch(`/api/students/${studentId}`, { method: 'DELETE' });
      setStudents(prev => prev.filter(s => s.id !== studentId));
    } catch (error) {
      console.error('Failed to delete student', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  // --- VIEW: Session List ---
  if (!activeSession) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-8 h-8 text-indigo-600" />
                AutoGrader Sessions
              </h1>
              <p className="text-slate-600 mt-2">Manage your grading sessions and assignments.</p>
            </div>
            <button
              onClick={() => setIsCreatingSession(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> New Session
            </button>
          </div>

          {isCreatingSession && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
              <h2 className="text-xl font-semibold mb-4">Create New Grading Session</h2>
              <form onSubmit={handleCreateSession} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Session Name *</label>
                  <input
                    type="text"
                    required
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                    placeholder="e.g., Fall 2026 - Midterm Exam"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Assignment & Rubric (PDF) *</label>
                  <input
                    type="file"
                    required
                    accept=".pdf"
                    onChange={(e) => setAssignmentFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Model Answer (Optional PDF)</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setModelAnswerFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Course Materials (Optional PDFs)</label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf"
                    onChange={(e) => setCourseMaterialsFiles(e.target.files)}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">General Instructions (Optional)</label>
                  <textarea
                    value={genericInstructions}
                    onChange={(e) => setGenericInstructions(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md h-24"
                    placeholder="e.g., Be brief, focus on code quality..."
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreatingSession(false)}
                    className="px-4 py-2 text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingSession || !assignmentFile || !sessionName}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isSubmittingSession ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Create Session
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="grid gap-4">
            {sessions.length === 0 && !isCreatingSession && (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
                <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-slate-900">No sessions yet</h3>
                <p className="text-slate-500 mt-1">Create your first grading session to get started.</p>
              </div>
            )}
            {sessions.map(session => (
              <div key={session.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex justify-between items-center hover:border-indigo-300 transition-colors cursor-pointer" onClick={() => setActiveSession(session)}>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{session.name}</h3>
                  <div className="text-sm text-slate-500 mt-1 flex items-center gap-4">
                    <span className="flex items-center gap-1"><FileText className="w-4 h-4" /> {session.assignment_filename}</span>
                    <span className="flex items-center gap-1"><Users className="w-4 h-4" /> Open Session</span>
                  </div>
                </div>
                <ArrowLeft className="w-5 h-5 text-slate-400 rotate-180" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: Active Session ---
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar: Session Details */}
      <div className="w-full md:w-80 bg-white border-r border-slate-200 p-6 flex flex-col h-screen overflow-y-auto sticky top-0">
        <button 
          onClick={() => setActiveSession(null)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Sessions
        </button>

        <h2 className="text-xl font-bold text-slate-900 mb-6">{activeSession.name}</h2>

        <div className="space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Assignment</h3>
            <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">
              <CheckCircle className="w-4 h-4" />
              <span className="truncate" title={activeSession.assignment_filename}>{activeSession.assignment_filename}</span>
            </div>
          </div>

          {activeSession.model_answer_filename && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Model Answer</h3>
              <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">
                <CheckCircle className="w-4 h-4" />
                <span className="truncate" title={activeSession.model_answer_filename}>{activeSession.model_answer_filename}</span>
              </div>
            </div>
          )}

          {activeSession.course_materials && activeSession.course_materials.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Course Materials</h3>
              <div className="space-y-2">
                {activeSession.course_materials.map((cm, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate" title={cm.filename}>{cm.filename}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSession.generic_instructions && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Instructions</h3>
              <div className="text-sm text-slate-700 bg-slate-50 p-3 rounded border border-slate-200 whitespace-pre-wrap">
                {activeSession.generic_instructions}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content: Students */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Students to Grade</h1>
              <p className="text-slate-600 mt-1">Add students and upload their solutions to begin grading.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const fb = prompt("Enter any global feedback for the AI (optional):");
                  if (fb !== null) {
                    handleGradeAll(true, fb);
                  }
                }}
                disabled={students.length === 0}
                className="bg-amber-100 text-amber-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4" /> Regrade All
              </button>
              <button
                onClick={() => handleGradeAll(false)}
                disabled={!students.some(s => s.status === 'idle' || s.status === 'error')}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" /> Grade All Ungraded
              </button>
              <button
                onClick={() => setIsAddingStudent(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Student
              </button>
            </div>
          </div>

          {isAddingStudent && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
              <h2 className="text-lg font-semibold mb-4">Add Student Submission</h2>
              <form onSubmit={handleAddStudent} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Student Name</label>
                    <input
                      type="text"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md"
                      placeholder="e.g., Jane Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Student ID (Optional)</label>
                    <input
                      type="text"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md"
                      placeholder="e.g., 12345678"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Student Solution File (PDF) *</label>
                  <input
                    type="file"
                    required
                    accept=".pdf"
                    onChange={(e) => setSolutionFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAddingStudent(false)}
                    className="px-4 py-2 text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingStudent || !solutionFile}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isSubmittingStudent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add Student
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="space-y-6">
            {students.length === 0 && !isAddingStudent && (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
                <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-slate-900">No students added yet</h3>
                <p className="text-slate-500 mt-1">Click the button above to add a student submission.</p>
              </div>
            )}

            {students.map(student => (
              <div key={student.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {student.name || 'Unnamed Student'}
                      {student.student_id && <span className="text-sm font-normal text-slate-500 ml-2">({student.student_id})</span>}
                    </h3>
                    <div className="flex items-center gap-2 mt-2 text-sm text-slate-600">
                      <FileText className="w-4 h-4" />
                      {student.solution_filename}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {student.status === 'idle' && (
                      <button
                        onClick={() => handleGradeStudent(student.id)}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                      >
                        <Play className="w-4 h-4" /> Grade Assignment
                      </button>
                    )}
                    {student.status === 'grading' && (
                      <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" /> Grading...
                      </div>
                    )}
                    {student.status === 'graded' && (
                      <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg font-medium">
                        <CheckCircle className="w-4 h-4" /> Graded
                      </div>
                    )}
                    {student.status === 'error' && (
                      <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg font-medium">
                        <AlertCircle className="w-4 h-4" /> Failed
                      </div>
                    )}
                    <button
                      onClick={() => handleDeleteStudent(student.id)}
                      className="text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Remove Student"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {student.status === 'error' && (
                  <div className="p-4 bg-red-50 border-t border-red-100 text-red-700 text-sm flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Grading failed</p>
                      <p className="mt-1">There was an error processing the assignment. Please try again.</p>
                      <button 
                        onClick={() => handleGradeStudent(student.id)}
                        className="mt-2 text-red-700 underline font-medium hover:text-red-800"
                      >
                        Retry Grading
                      </button>
                    </div>
                  </div>
                )}

                {student.status === 'graded' && (
                  <div className="p-6 bg-white">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="md:col-span-1">
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-center h-full flex flex-col justify-center">
                          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">Recommended Grade</p>
                          <p className="text-3xl font-bold text-indigo-600">{student.grade}</p>
                        </div>
                      </div>
                      <div className="md:col-span-3">
                        <h4 className="text-sm font-medium text-slate-900 mb-2">Justification</h4>
                        <div className="text-slate-700 text-sm leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200 whitespace-pre-wrap">
                          {student.justification}
                        </div>
                        <div className="mt-4 flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-sm font-medium text-slate-700">Instructor Feedback for AI (for Regrading)</label>
                            <textarea
                              className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                              rows={2}
                              placeholder="e.g., You deducted points for X, but X is actually correct according to the rubric."
                              value={studentFeedbacks[student.id] || ''}
                              onChange={(e) => setStudentFeedbacks(prev => ({ ...prev, [student.id]: e.target.value }))}
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button 
                              onClick={() => handleGradeStudent(student.id, studentFeedbacks[student.id])}
                              className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded font-medium flex items-center gap-1 hover:bg-indigo-200 transition-colors"
                            >
                              <Play className="w-4 h-4" /> Regrade This Student
                            </button>
                            <button 
                              onClick={() => {
                                if (confirm("This will regrade ALL students in this session using this feedback. Continue?")) {
                                  handleGradeAll(true, `Regarding student ${student.name || student.id}: ${studentFeedbacks[student.id] || ''}`);
                                }
                              }}
                              className="text-sm bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded font-medium flex items-center gap-1 hover:bg-emerald-200 transition-colors"
                            >
                              <RefreshCw className="w-4 h-4" /> Regrade ALL with this Feedback
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
