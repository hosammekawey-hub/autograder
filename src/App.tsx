import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Plus, Trash2, ArrowLeft, BookOpen, Users, Play, RefreshCw, Edit2, X, Eye, EyeOff, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { upload } from '@vercel/blob/client';

type Session = {
  id: string;
  name: string;
  assignment_url: string;
  assignment_filename: string;
  model_answer_url?: string;
  model_answer_filename?: string;
  course_materials: { url: string, filename: string }[];
  generic_instructions?: string;
  llm_model?: string;
  created_at: string;
};

type Student = {
  id: string;
  session_id: string;
  name: string;
  student_id: string;
  solution_url: string;
  solution_filename: string;
  grade?: string;
  justification?: string;
  grading_details?: string;
  feedback?: string;
  status: 'idle' | 'grading' | 'graded' | 'error';
};

type GradingDetail = {
  question_number: string;
  question_text: string;
  model_answer: string;
  student_answer: string;
  identified_issue: string;
  suggested_grade: string;
  max_grade?: string;
};

function StudentGradingDetails({ student, onUpdate, llmModel }: { student: Student, onUpdate: (studentId: string, updates: Partial<Student>) => void, llmModel?: string }) {
  const [details, setDetails] = useState<GradingDetail[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedGrade, setEditedGrade] = useState(student.grade || '');
  const [isExpanded, setIsExpanded] = useState(false);
  const [regradingIndex, setRegradingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (student.grading_details) {
      try {
        setDetails(JSON.parse(student.grading_details));
      } catch (e) {
        console.error("Failed to parse grading details", e);
      }
    }
  }, [student.grading_details]);

  const handleDetailChange = (index: number, field: keyof GradingDetail, value: string) => {
    const newDetails = [...details];
    newDetails[index] = { ...newDetails[index], [field]: value };
    setDetails(newDetails);
    
    if (field === 'suggested_grade') {
      const total = newDetails.reduce((sum, detail) => {
        const grade = parseFloat(detail.suggested_grade) || 0;
        return sum + grade;
      }, 0);
      setEditedGrade(total.toString());
    }
  };

  const handleRegradeEntry = async (index: number) => {
    setRegradingIndex(index);
    const detail = details[index];
    try {
      const res = await fetch('/api/regrade-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text: detail.question_text,
          model_answer: detail.model_answer,
          student_answer: detail.student_answer,
          max_grade: detail.max_grade || '',
          llmModel: llmModel
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const newDetails = [...details];
        newDetails[index] = {
          ...newDetails[index],
          identified_issue: data.identified_issue,
          suggested_grade: data.suggested_grade
        };
        setDetails(newDetails);
        
        // Recalculate total grade
        const total = newDetails.reduce((sum, d) => {
          const grade = parseFloat(d.suggested_grade) || 0;
          return sum + grade;
        }, 0);
        setEditedGrade(total.toString());
      } else {
        alert(`Regrade failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Regrade error:', error);
      alert('Failed to regrade entry.');
    } finally {
      setRegradingIndex(null);
    }
  };

  const handleSave = () => {
    onUpdate(student.id, {
      grade: editedGrade,
      grading_details: JSON.stringify(details)
    });
    setIsEditing(false);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.text(`Grading Report: ${student.name} (${student.student_id})`, 14, 15);
    doc.text(`Total Grade: ${student.grade || 'N/A'}`, 14, 25);
    
    const tableData = details.map(d => [
      d.question_number,
      d.identified_issue,
      d.model_answer,
      d.suggested_grade
    ]);

    autoTable(doc, {
      startY: 30,
      head: [['Q#', 'Identified Issue', 'Model Answer', 'Grade']],
      body: tableData,
    });

    doc.save(`${student.name}_Grading_Report.pdf`);
  };

  const handleExportExcel = () => {
    const tableData = details.map(d => ({
      'Q#': d.question_number,
      'Identified Issue': d.identified_issue,
      'Model Answer': d.model_answer,
      'Grade': d.suggested_grade
    }));

    const ws = XLSX.utils.json_to_sheet(tableData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Grading Report");
    XLSX.writeFile(wb, `${student.name}_Grading_Report.xlsx`);
  };

  if (!student.grading_details || details.length === 0) return null;

  return (
    <div className="mt-6 border-t border-slate-200 pt-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
          {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
          <h4 className="text-lg font-semibold text-slate-900">Detailed Grading Report</h4>
        </div>
        {!isEditing ? (
          <div className="flex items-center gap-2">
            <button onClick={handleExportPDF} className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded font-medium flex items-center gap-1 hover:bg-slate-200 transition-colors">
              <Download className="w-4 h-4" /> PDF
            </button>
            <button onClick={handleExportExcel} className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded font-medium flex items-center gap-1 hover:bg-slate-200 transition-colors">
              <Download className="w-4 h-4" /> Excel
            </button>
            <button onClick={() => { 
              setIsExpanded(true);
              setIsEditing(true); 
              const total = details.reduce((sum, detail) => sum + (parseFloat(detail.suggested_grade) || 0), 0);
              setEditedGrade(total > 0 ? total.toString() : (student.grade || '')); 
            }} className="text-sm bg-slate-100 text-slate-700 px-3 py-1.5 rounded font-medium flex items-center gap-1 hover:bg-slate-200 transition-colors">
              <Edit2 className="w-4 h-4" /> Edit Report
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => setIsEditing(false)} className="text-sm text-slate-500 hover:text-slate-700 font-medium px-3 py-1.5">Cancel</button>
            <button onClick={handleSave} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded font-medium hover:bg-indigo-700 transition-colors">Save Changes</button>
          </div>
        )}
      </div>

      {isExpanded && (
        <>
          {isEditing && (
            <div className="mb-4 flex items-center gap-4 bg-indigo-50 p-4 rounded-lg border border-indigo-100">
              <label className="text-sm font-medium text-indigo-900">Overall Grade Override:</label>
              <input 
                type="text" 
                value={editedGrade} 
                onChange={(e) => setEditedGrade(e.target.value)}
                className="border border-indigo-200 rounded px-3 py-1.5 text-sm font-bold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm text-left text-slate-600 border-collapse">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Q#</th>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Question Text</th>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Model Answer</th>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Student Answer</th>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Identified Issue</th>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Grade</th>
                  <th className="px-4 py-3 font-medium border-r border-slate-200">Max Grade</th>
                  {isEditing && <th className="px-4 py-3 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {details.map((detail, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 align-top">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap border-r border-slate-200">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={detail.question_number} 
                          onChange={(e) => handleDetailChange(idx, 'question_number', e.target.value)}
                          className="w-16 border border-slate-300 rounded p-1.5 text-sm font-medium"
                        />
                      ) : (
                        detail.question_number
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[200px] border-r border-slate-200">
                      {isEditing ? (
                        <textarea 
                          value={detail.question_text} 
                          onChange={(e) => handleDetailChange(idx, 'question_text', e.target.value)}
                          className="w-full border border-slate-300 rounded p-1.5 text-sm"
                          rows={3}
                        />
                      ) : (
                        detail.question_text
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[200px] border-r border-slate-200">
                      {isEditing ? (
                        <textarea 
                          value={detail.model_answer} 
                          onChange={(e) => handleDetailChange(idx, 'model_answer', e.target.value)}
                          className="w-full border border-slate-300 rounded p-1.5 text-sm"
                          rows={3}
                        />
                      ) : (
                        detail.model_answer
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[200px] border-r border-slate-200">
                      {isEditing ? (
                        <textarea 
                          value={detail.student_answer} 
                          onChange={(e) => handleDetailChange(idx, 'student_answer', e.target.value)}
                          className="w-full border border-slate-300 rounded p-1.5 text-sm"
                          rows={3}
                        />
                      ) : (
                        detail.student_answer
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[200px] border-r border-slate-200">
                      {isEditing ? (
                        <textarea 
                          value={detail.identified_issue} 
                          onChange={(e) => handleDetailChange(idx, 'identified_issue', e.target.value)}
                          className="w-full border border-slate-300 rounded p-1.5 text-sm"
                          rows={3}
                        />
                      ) : (
                        <span className={detail.identified_issue.toLowerCase() === 'none' ? 'text-emerald-600 font-medium' : 'text-amber-700'}>
                          {detail.identified_issue}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap border-r border-slate-200">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={detail.suggested_grade} 
                          onChange={(e) => handleDetailChange(idx, 'suggested_grade', e.target.value)}
                          className="w-20 border border-slate-300 rounded p-1.5 text-sm font-medium"
                        />
                      ) : (
                        <span className="font-medium text-slate-900">{detail.suggested_grade}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap border-r border-slate-200">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={detail.max_grade || ''} 
                          onChange={(e) => handleDetailChange(idx, 'max_grade', e.target.value)}
                          className="w-20 border border-slate-300 rounded p-1.5 text-sm font-medium"
                        />
                      ) : (
                        <span className="font-medium text-slate-500">{detail.max_grade || '-'}</span>
                      )}
                    </td>
                    {isEditing && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => handleRegradeEntry(idx)}
                          disabled={regradingIndex === idx}
                          className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-medium hover:bg-indigo-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {regradingIndex === idx ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Regrading...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3 h-3" />
                              Regrade
                            </>
                          )}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

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
  const [llmModel, setLlmModel] = useState('gemini-3.1-pro-preview');
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);

  // Add Student State
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [solutionFile, setSolutionFile] = useState<File | null>(null);
  const [isSubmittingStudent, setIsSubmittingStudent] = useState(false);
  const [studentFeedbacks, setStudentFeedbacks] = useState<Record<string, string>>({});
  const [expandedPreviews, setExpandedPreviews] = useState<Record<string, boolean>>({});

  // Update Session State
  const [isUpdatingSession, setIsUpdatingSession] = useState(false);
  const [newAssignmentFile, setNewAssignmentFile] = useState<File | null>(null);
  const [newModelAnswerFile, setNewModelAnswerFile] = useState<File | null>(null);
  const [newCourseMaterialsFiles, setNewCourseMaterialsFiles] = useState<FileList | null>(null);
  const [newGenericInstructions, setNewGenericInstructions] = useState('');
  const [newLlmModel, setNewLlmModel] = useState('gemini-3.1-pro-preview');
  const [deletedCourseMaterials, setDeletedCourseMaterials] = useState<string[]>([]);
  const [deleteModelAnswer, setDeleteModelAnswer] = useState(false);
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState(false);

  // Regrade Modal State
  const [isRegradeModalOpen, setIsRegradeModalOpen] = useState(false);
  const [regradeFeedback, setRegradeFeedback] = useState('');

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
    
    try {
      // 1. Fetch blob token
      const tokenRes = await fetch('/api/upload-token');
      const { token } = await tokenRes.json();

      const formData = new FormData();
      const sessionId = uuidv4();
      formData.append('id', sessionId);
      formData.append('name', sessionName);
      formData.append('genericInstructions', genericInstructions);
      formData.append('llmModel', llmModel);

      if (token) {
        // Upload directly to Vercel Blob
        const assignmentBlob = await upload(assignmentFile.name, assignmentFile, { access: 'public', handleUploadUrl: '/api/upload' });
        formData.append('assignment_url', assignmentBlob.url);
        formData.append('assignment_filename', assignmentFile.name);

        if (modelAnswerFile) {
          const modelAnswerBlob = await upload(modelAnswerFile.name, modelAnswerFile, { access: 'public', handleUploadUrl: '/api/upload' });
          formData.append('model_answer_url', modelAnswerBlob.url);
          formData.append('model_answer_filename', modelAnswerFile.name);
        }

        if (courseMaterialsFiles && courseMaterialsFiles.length > 0) {
          const courseMaterials = [];
          for (const file of Array.from(courseMaterialsFiles as Iterable<File>)) {
            const cmBlob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload' });
            courseMaterials.push({ url: cmBlob.url, filename: file.name });
          }
          formData.append('course_materials_json', JSON.stringify(courseMaterials));
        }
      } else {
        // Fallback to standard upload
        formData.append('assignment', assignmentFile);
        if (modelAnswerFile) formData.append('modelAnswer', modelAnswerFile);
        if (courseMaterialsFiles) {
          Array.from(courseMaterialsFiles as Iterable<File>).forEach(file => {
            formData.append('courseMaterials', file);
          });
        }
      }

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
        setLlmModel('gemini-3.1-pro-preview');
      } else {
        const data = await res.json();
        alert(`Failed to create session: ${data.details || data.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Network error while creating session.');
    } finally {
      setIsSubmittingSession(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !solutionFile) return;

    setIsSubmittingStudent(true);
    
    try {
      // 1. Fetch blob token
      const tokenRes = await fetch('/api/upload-token');
      const { token } = await tokenRes.json();

      let solution_url = '';
      let solution_filename = '';
      let formData = new FormData();

      if (token) {
        // Upload directly to Vercel Blob from browser
        const blob = await upload(solutionFile.name, solutionFile, {
          access: 'public',
          handleUploadUrl: '/api/upload'
        });
        solution_url = blob.url;
        solution_filename = solutionFile.name;
        
        formData.append('id', uuidv4());
        formData.append('name', studentName);
        formData.append('student_id', studentId);
        formData.append('solution_url', solution_url);
        formData.append('solution_filename', solution_filename);
      } else {
        // Fallback to standard upload
        formData.append('id', uuidv4());
        formData.append('name', studentName);
        formData.append('student_id', studentId);
        formData.append('solution', solutionFile);
      }

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
      console.error(error);
      alert('Network error while adding student.');
    } finally {
      setIsSubmittingStudent(false);
    }
  };

  const handleUpdateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    
    const hasInstructionsChanged = newGenericInstructions !== (activeSession.generic_instructions || '');
    const hasModelChanged = newLlmModel !== (activeSession.llm_model || 'gemini-3.1-pro-preview');
    
    if (!newAssignmentFile && !newModelAnswerFile && !newCourseMaterialsFiles && !hasInstructionsChanged && !hasModelChanged && deletedCourseMaterials.length === 0 && !deleteModelAnswer) return;

    setIsSubmittingUpdate(true);
    
    try {
      // 1. Fetch blob token
      const tokenRes = await fetch('/api/upload-token');
      const { token } = await tokenRes.json();

      const formData = new FormData();
      
      if (token) {
        if (newAssignmentFile) {
          const assignmentBlob = await upload(newAssignmentFile.name, newAssignmentFile, { access: 'public', handleUploadUrl: '/api/upload' });
          formData.append('assignment_url', assignmentBlob.url);
          formData.append('assignment_filename', newAssignmentFile.name);
        }
        if (newModelAnswerFile) {
          const modelAnswerBlob = await upload(newModelAnswerFile.name, newModelAnswerFile, { access: 'public', handleUploadUrl: '/api/upload' });
          formData.append('model_answer_url', modelAnswerBlob.url);
          formData.append('model_answer_filename', newModelAnswerFile.name);
        }
        if (newCourseMaterialsFiles && newCourseMaterialsFiles.length > 0) {
          const courseMaterials = [];
          for (const file of Array.from(newCourseMaterialsFiles as Iterable<File>)) {
            const cmBlob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/upload' });
            courseMaterials.push({ url: cmBlob.url, filename: file.name });
          }
          formData.append('course_materials_json', JSON.stringify(courseMaterials));
        }
      } else {
        if (newAssignmentFile) formData.append('assignment', newAssignmentFile);
        if (newModelAnswerFile) formData.append('modelAnswer', newModelAnswerFile);
        if (newCourseMaterialsFiles) {
          Array.from(newCourseMaterialsFiles as Iterable<File>).forEach(file => {
            formData.append('courseMaterials', file);
          });
        }
      }

      if (hasInstructionsChanged) {
        formData.append('genericInstructions', newGenericInstructions);
      }
      if (hasModelChanged) {
        formData.append('llmModel', newLlmModel);
      }
      if (deletedCourseMaterials.length > 0) {
        formData.append('deletedCourseMaterials', JSON.stringify(deletedCourseMaterials));
      }
      if (deleteModelAnswer) {
        formData.append('deleteModelAnswer', 'true');
      }

      const res = await fetch(`/api/sessions/${activeSession.id}`, {
        method: 'PATCH',
        body: formData,
      });
      if (res.ok) {
        await fetchSessions();
        // Update active session locally
        const updatedSessionsRes = await fetch('/api/sessions');
        const updatedSessions = await updatedSessionsRes.json();
        const updatedActive = updatedSessions.find((s: Session) => s.id === activeSession.id);
        if (updatedActive) setActiveSession(updatedActive);
        
        setIsUpdatingSession(false);
        setNewAssignmentFile(null);
        setNewModelAnswerFile(null);
        setNewCourseMaterialsFiles(null);
        setDeletedCourseMaterials([]);
        setDeleteModelAnswer(false);
      } else {
        const data = await res.json();
        alert(`Failed to update session: ${data.details || data.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Network error while updating session.');
    } finally {
      setIsSubmittingUpdate(false);
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

  const handleUpdateStudentGrade = async (studentId: string, updates: Partial<Student>) => {
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updates } : s));
      } else {
        alert('Failed to update student grade');
      }
    } catch (error) {
      console.error(error);
      alert('Network error while updating grade');
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
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">LLM Model</label>
                  <select
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                  >
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Best Quality)</option>
                    <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash</option>
                    <option value="gemini-3-flash-preview">Gemini 3 Flash (Fastest)</option>
                  </select>
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
            <div className="flex items-center justify-between text-sm text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">
              <div className="flex items-center gap-2 overflow-hidden">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span className="truncate" title={activeSession.assignment_filename}>{activeSession.assignment_filename}</span>
              </div>
              <button 
                onClick={() => setExpandedPreviews(prev => ({ ...prev, assignment: !prev.assignment }))}
                className="p-1 hover:bg-emerald-100 rounded text-emerald-700 transition-colors shrink-0"
                title="Toggle Preview"
              >
                {expandedPreviews['assignment'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {expandedPreviews['assignment'] && activeSession.assignment_url && (
              <div className="mt-2 h-64 border border-slate-200 rounded overflow-hidden bg-white">
                <iframe src={activeSession.assignment_url} className="w-full h-full" title="Assignment Preview" />
              </div>
            )}
          </div>

          {activeSession.model_answer_filename && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Model Answer</h3>
              <div className="flex items-center justify-between text-sm text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">
                <div className="flex items-center gap-2 overflow-hidden">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span className="truncate" title={activeSession.model_answer_filename}>{activeSession.model_answer_filename}</span>
                </div>
                <button 
                  onClick={() => setExpandedPreviews(prev => ({ ...prev, modelAnswer: !prev.modelAnswer }))}
                  className="p-1 hover:bg-emerald-100 rounded text-emerald-700 transition-colors shrink-0"
                  title="Toggle Preview"
                >
                  {expandedPreviews['modelAnswer'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {expandedPreviews['modelAnswer'] && activeSession.model_answer_url && (
                <div className="mt-2 h-64 border border-slate-200 rounded overflow-hidden bg-white">
                  <iframe src={activeSession.model_answer_url} className="w-full h-full" title="Model Answer Preview" />
                </div>
              )}
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

          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">LLM Model</h3>
            <div className="text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">
              {activeSession.llm_model === 'gemini-3.1-pro-preview' ? 'Gemini 3.1 Pro' : 
               activeSession.llm_model === 'gemini-3-pro-preview' ? 'Gemini 3 Pro' : 
               activeSession.llm_model === 'gemini-3.1-flash-lite-preview' ? 'Gemini 3.1 Flash' : 
               activeSession.llm_model === 'gemini-3-flash-preview' ? 'Gemini 3 Flash' : 
               (activeSession.llm_model || 'Gemini 3.1 Pro')}
            </div>
          </div>

          {!isUpdatingSession ? (
            <button
              onClick={() => {
                setIsUpdatingSession(true);
                setNewGenericInstructions(activeSession.generic_instructions || '');
                setNewLlmModel(activeSession.llm_model || 'gemini-3.1-pro-preview');
                setDeletedCourseMaterials([]);
                setDeleteModelAnswer(false);
              }}
              className="w-full mt-4 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors text-sm font-medium"
            >
              <Edit2 className="w-4 h-4" /> Update Session
            </button>
          ) : (
            <form onSubmit={handleUpdateSession} className="mt-6 p-4 bg-slate-100 rounded-lg border border-slate-200 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">Update Session</h3>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">New Assignment (PDF)</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setNewAssignmentFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 flex justify-between">
                  New Model Answer (PDF)
                  {activeSession.model_answer_filename && !deleteModelAnswer && (
                    <button type="button" onClick={() => setDeleteModelAnswer(true)} className="text-red-600 hover:text-red-800 text-xs">Delete Existing</button>
                  )}
                  {deleteModelAnswer && (
                    <span className="text-red-600 text-xs italic">Will be deleted</span>
                  )}
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setNewModelAnswerFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Course Materials</label>
                {activeSession.course_materials && activeSession.course_materials.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {activeSession.course_materials.map((cm, idx) => {
                      const isDeleted = deletedCourseMaterials.includes(cm.url);
                      return (
                        <div key={idx} className={`flex items-center justify-between text-xs p-1 rounded border ${isDeleted ? 'bg-red-50 border-red-100 text-red-500 line-through' : 'bg-white border-slate-200 text-slate-600'}`}>
                          <span className="truncate" title={cm.filename}>{cm.filename}</span>
                          {!isDeleted ? (
                            <button type="button" onClick={() => setDeletedCourseMaterials([...deletedCourseMaterials, cm.url])} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="w-3 h-3" /></button>
                          ) : (
                            <button type="button" onClick={() => setDeletedCourseMaterials(deletedCourseMaterials.filter(url => url !== cm.url))} className="text-slate-500 hover:text-slate-700 p-1 text-[10px]">Undo</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <label className="block text-xs font-medium text-slate-700 mb-1">Add New Course Materials (PDFs)</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf"
                  onChange={(e) => setNewCourseMaterialsFiles(e.target.files)}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">LLM Model</label>
                <select
                  value={newLlmModel}
                  onChange={(e) => setNewLlmModel(e.target.value)}
                  className="w-full border border-slate-300 rounded p-2 text-xs"
                >
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Best Quality)</option>
                  <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                  <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash</option>
                  <option value="gemini-3-flash-preview">Gemini 3 Flash (Fastest)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Instructions</label>
                <textarea
                  className="w-full border border-slate-300 rounded p-2 text-xs min-h-[80px]"
                  value={newGenericInstructions}
                  onChange={(e) => setNewGenericInstructions(e.target.value)}
                  placeholder="e.g., Be lenient on question 2..."
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUpdatingSession(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingUpdate || (!newAssignmentFile && !newModelAnswerFile && !newCourseMaterialsFiles && newGenericInstructions === (activeSession.generic_instructions || '') && newLlmModel === (activeSession.llm_model || 'gemini-3.1-pro-preview') && deletedCourseMaterials.length === 0 && !deleteModelAnswer)}
                  className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmittingUpdate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  Update
                </button>
              </div>
            </form>
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
                onClick={() => setIsRegradeModalOpen(true)}
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
                      <button 
                        onClick={() => setExpandedPreviews(prev => ({ ...prev, [student.id]: !prev[student.id] }))}
                        className="ml-2 p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors"
                        title="Toggle Preview"
                      >
                        {expandedPreviews[student.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
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

                {expandedPreviews[student.id] && student.solution_url && (
                  <div className="border-t border-slate-200 bg-slate-50 p-4">
                    <div className="h-96 border border-slate-200 rounded overflow-hidden bg-white">
                      <iframe src={student.solution_url} className="w-full h-full" title="Student Submission Preview" />
                    </div>
                  </div>
                )}

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
                    <StudentGradingDetails student={student} onUpdate={handleUpdateStudentGrade} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Regrade All Modal */}
      {isRegradeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-amber-600" />
                Regrade All Students
              </h2>
              <button 
                onClick={() => setIsRegradeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4">
                You are about to regrade all students in this session. You can optionally provide feedback or new instructions for the AI to consider during this regrade.
              </p>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Global Feedback / Instructions (Optional)
              </label>
              <textarea
                className="w-full border border-slate-300 rounded-lg p-3 text-sm min-h-[120px] focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="e.g., Please be more lenient on question 3. Accept 'X' as a valid answer."
                value={regradeFeedback}
                onChange={(e) => setRegradeFeedback(e.target.value)}
              />
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setIsRegradeModalOpen(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleGradeAll(true, regradeFeedback);
                  setIsRegradeModalOpen(false);
                  setRegradeFeedback('');
                }}
                className="bg-amber-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-amber-700 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Start Regrade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
