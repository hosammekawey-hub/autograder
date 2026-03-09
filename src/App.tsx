import React, { useState, useEffect } from 'react';
import { FileUp, FileText, BookOpen, UserPlus, GraduationCap, CheckCircle, AlertCircle, Loader2, RefreshCw, MessageSquare } from 'lucide-react';
import { Student } from './types';

export default function App() {
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null);
  const [modelAnswerFile, setModelAnswerFile] = useState<File | null>(null);
  const [courseMaterials, setCourseMaterials] = useState<File[]>([]);
  const [genericInstructions, setGenericInstructions] = useState<string>('');
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    fetch('/api/students')
      .then(res => res.json())
      .then(data => {
        const mapped = data.map((s: any) => ({
          id: s.id,
          name: s.name || '',
          studentId: s.student_id || '',
          solutionFile: null,
          solutionUrl: s.solution_url,
          solutionFilename: s.solution_filename,
          grade: s.grade,
          justification: s.justification,
          feedback: s.feedback || '',
          status: s.status
        }));
        setStudents(mapped);
      })
      .catch(err => console.error('Failed to load students', err));
  }, []);

  const handleAddStudent = async () => {
    const newStudent = {
      id: crypto.randomUUID(),
      name: '',
      studentId: '',
      solutionFile: null,
      grade: null,
      justification: null,
      feedback: null,
      status: 'idle' as const,
    };
    
    setStudents([...students, newStudent]);

    await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newStudent.id,
        name: newStudent.name,
        student_id: newStudent.studentId,
        status: newStudent.status
      })
    });
  };

  const handleUpdateStudent = async (id: string, updates: Partial<Student>) => {
    setStudents(students.map(s => (s.id === id ? { ...s, ...updates } : s)));

    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.studentId !== undefined) dbUpdates.student_id = updates.studentId;
    if (updates.feedback !== undefined) dbUpdates.feedback = updates.feedback;
    if (updates.status !== undefined) dbUpdates.status = updates.status;

    if (Object.keys(dbUpdates).length > 0) {
      await fetch(`/api/students/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdates)
      });
    }
  };

  const handleRemoveStudent = async (id: string) => {
    setStudents(students.filter(s => s.id !== id));
    await fetch(`/api/students/${id}`, { method: 'DELETE' });
  };

  const handleGradeStudent = async (student: Student) => {
    if (!assignmentFile) {
      alert('Please upload an assignment file first.');
      return;
    }
    if (!student.solutionFile && !student.solutionUrl) {
      alert('Please upload a solution file for the student.');
      return;
    }

    handleUpdateStudent(student.id, { status: 'grading', grade: null, justification: null });

    const formData = new FormData();
    formData.append('assignment', assignmentFile);
    if (modelAnswerFile) formData.append('modelAnswer', modelAnswerFile);
    courseMaterials.forEach(f => formData.append('courseMaterials', f));
    if (student.solutionFile) formData.append('solution', student.solutionFile);
    
    formData.append('studentName', student.name);
    formData.append('studentId', student.studentId);
    formData.append('genericInstructions', genericInstructions);
    if (student.feedback) formData.append('feedback', student.feedback);

    try {
      const res = await fetch(`/api/students/${student.id}/grade`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        handleUpdateStudent(student.id, {
          status: 'graded',
          grade: data.grade,
          justification: data.justification,
          solutionUrl: data.solutionUrl,
          solutionFilename: data.solutionFilename
        });
      } else {
        console.error('Grading error:', data.error);
        handleUpdateStudent(student.id, { status: 'error' });
      }
    } catch (error) {
      console.error('Grading error:', error);
      handleUpdateStudent(student.id, { status: 'error' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col md:flex-row">
      {/* Sidebar / Global Settings */}
      <aside className="w-full md:w-80 bg-white border-r border-slate-200 p-6 flex flex-col gap-6 overflow-y-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-indigo-900 flex items-center gap-2">
            <GraduationCap className="w-8 h-8 text-indigo-600" />
            AutoGrader
          </h1>
          <p className="text-sm text-slate-500 mt-1">Intelligent assignment grading</p>
        </div>

        <div className="space-y-6">
          {/* Assignment Upload */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Assignment & Rubric (Required)
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".pdf,.txt,.docx"
                onChange={(e) => setAssignmentFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer border border-slate-200 rounded-md"
              />
            </div>
            {assignmentFile && <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {assignmentFile.name}</p>}
          </div>

          {/* Model Answer Upload */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              Model Answer (Optional)
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".pdf,.txt,.docx"
                onChange={(e) => setModelAnswerFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer border border-slate-200 rounded-md"
              />
            </div>
            {modelAnswerFile && <p className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {modelAnswerFile.name}</p>}
          </div>

          {/* Course Materials Upload */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Course Materials (Optional)
            </label>
            <div className="relative">
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.docx"
                onChange={(e) => setCourseMaterials(Array.from(e.target.files || []))}
                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer border border-slate-200 rounded-md"
              />
            </div>
            {courseMaterials.length > 0 && (
              <ul className="text-xs text-emerald-600 space-y-1">
                {courseMaterials.map((f, i) => (
                  <li key={i} className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {f.name}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Generic Instructions */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              General Instructions
            </label>
            <p className="text-xs text-slate-500">Apply to all grading (e.g., "be brief", "focus on grammar")</p>
            <textarea
              rows={3}
              placeholder="e.g. Be brief, focus on code quality, ignore spelling mistakes..."
              value={genericInstructions}
              onChange={(e) => setGenericInstructions(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y"
            />
          </div>
        </div>
      </aside>

      {/* Main Content / Students List */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Students to Grade</h2>
              <p className="text-sm text-slate-500 mt-1">Add students and upload their solutions to begin grading.</p>
            </div>
            <button
              onClick={handleAddStudent}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium text-sm"
            >
              <UserPlus className="w-4 h-4" />
              Add Student
            </button>
          </div>

          {students.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
              <GraduationCap className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900">No students added yet</h3>
              <p className="text-slate-500 mt-1 mb-6">Click the button above to add a student and start grading.</p>
              <button
                onClick={handleAddStudent}
                className="inline-flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors shadow-sm font-medium text-sm"
              >
                <UserPlus className="w-4 h-4" />
                Add First Student
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {students.map((student) => (
                <div key={student.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Student Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Jane Doe"
                          value={student.name}
                          onChange={(e) => handleUpdateStudent(student.id, { name: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Student ID (Optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. 12345678"
                          value={student.studentId}
                          onChange={(e) => handleUpdateStudent(student.id, { studentId: e.target.value })}
                          className="w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveStudent(student.id)}
                      className="text-slate-400 hover:text-red-500 text-sm font-medium transition-colors self-start sm:self-center"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      {/* Solution Upload */}
                      <div className="flex-1 space-y-2">
                        <label className="block text-sm font-medium text-slate-700">Student Solution File</label>
                        <input
                          type="file"
                          accept=".pdf,.txt,.docx"
                          onChange={(e) => handleUpdateStudent(student.id, { solutionFile: e.target.files?.[0] || null })}
                          className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer border border-slate-200 rounded-md"
                        />
                        {(student.solutionFile || student.solutionFilename) && (
                          <p className="text-xs text-emerald-600 flex items-center gap-1 mt-1">
                            <CheckCircle className="w-3 h-3" /> 
                            {student.solutionFile ? student.solutionFile.name : student.solutionFilename}
                          </p>
                        )}
                      </div>

                      {/* Action Button */}
                      <div className="flex items-end">
                        <button
                          onClick={() => handleGradeStudent(student)}
                          disabled={student.status === 'grading' || (!student.solutionFile && !student.solutionUrl) || !assignmentFile}
                          className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium shadow-sm transition-all w-full md:w-auto ${
                            student.status === 'grading'
                              ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                              : (!student.solutionFile && !student.solutionUrl) || !assignmentFile
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {student.status === 'grading' ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Grading...
                            </>
                          ) : student.status === 'graded' ? (
                            <>
                              <RefreshCw className="w-4 h-4" />
                              Re-grade
                            </>
                          ) : (
                            'Grade Assignment'
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Error State */}
                    {student.status === 'error' && (
                      <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-start gap-3 border border-red-100">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-medium">Grading failed</h4>
                          <p className="text-sm mt-1 text-red-600">There was an error processing the assignment. Please try again.</p>
                        </div>
                      </div>
                    )}

                    {/* Results */}
                    {student.status === 'graded' && student.grade && (
                      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-5 space-y-4">
                        <div className="flex items-center justify-between border-b border-indigo-100 pb-4">
                          <h3 className="text-lg font-semibold text-indigo-900">Grading Results</h3>
                          <div className="bg-indigo-600 text-white px-4 py-1.5 rounded-full font-bold shadow-sm">
                            Grade: {student.grade}
                          </div>
                        </div>
                        
                        <div>
                          <h4 className="text-sm font-medium text-indigo-900 mb-2">Justification</h4>
                          <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-white p-4 rounded-lg border border-indigo-50">
                            {student.justification}
                          </div>
                        </div>

                        {/* Feedback for Re-grading */}
                        <div className="pt-4 border-t border-indigo-100">
                          <label className="block text-sm font-medium text-indigo-900 mb-2">
                            Provide Feedback & Re-grade
                          </label>
                          <p className="text-xs text-slate-500 mb-3">
                            If you disagree with the grade or want the AI to consider specific points, provide feedback below and click "Re-grade".
                          </p>
                          <textarea
                            rows={3}
                            placeholder="e.g. The student actually addressed the second point in paragraph 3, please revise the score."
                            value={student.feedback || ''}
                            onChange={(e) => handleUpdateStudent(student.id, { feedback: e.target.value })}
                            className="w-full bg-white border border-indigo-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
