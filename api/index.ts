import express from 'express';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import { put, del } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

// Increase Vercel Serverless Function timeout to 60 seconds
export const maxDuration = 60;

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- Database Setup ---
let db: any = null;
let isDbInitialized = false;

async function initDb() {
  if (isDbInitialized) return;
  console.log("Initializing Database...");

  try {
    if (process.env.POSTGRES_URL) {
      console.log("Connecting to Vercel Postgres...");
      await sql`
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255),
          assignment_url TEXT,
          assignment_filename TEXT,
          model_answer_url TEXT,
          model_answer_filename TEXT,
          course_materials TEXT,
          generic_instructions TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS students (
          id VARCHAR(255) PRIMARY KEY,
          session_id VARCHAR(255),
          name VARCHAR(255),
          student_id VARCHAR(255),
          solution_url TEXT,
          solution_filename TEXT,
          grade TEXT,
          justification TEXT,
          feedback TEXT,
          status VARCHAR(50)
        )
      `;
      // Attempt to add session_id if migrating from old schema
      try { await sql`ALTER TABLE students ADD COLUMN session_id VARCHAR(255)`; } catch (e) {}
      try { await sql`ALTER TABLE sessions ADD COLUMN llm_model VARCHAR(255)`; } catch (e) {}
      console.log("Vercel Postgres connected.");
    } else {
      console.log("Connecting to Local SQLite...");
      const Database = (await import('better-sqlite3')).default;
      db = new Database('autograder.db');
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          assignment_url TEXT,
          assignment_filename TEXT,
          model_answer_url TEXT,
          model_answer_filename TEXT,
          course_materials TEXT,
          generic_instructions TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS students (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          name TEXT,
          student_id TEXT,
          solution_url TEXT,
          solution_filename TEXT,
          grade TEXT,
          justification TEXT,
          feedback TEXT,
          status TEXT
        )
      `);
      try { db.exec(`ALTER TABLE students ADD COLUMN session_id TEXT`); } catch (e) {}
      try { db.exec(`ALTER TABLE sessions ADD COLUMN llm_model TEXT`); } catch (e) {}
      console.log("Local SQLite connected.");
    }
    isDbInitialized = true;
  } catch (error: any) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

// --- Storage Helpers ---
async function uploadFile(file: Express.Multer.File): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(file.originalname, file.buffer, { 
      access: 'public',
      addRandomSuffix: true
    });
    return blob.url;
  } else {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const filename = `${Date.now()}-${file.originalname}`;
    fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
    return `/uploads/${filename}`;
  }
}

async function deleteFile(url: string | null | undefined) {
  if (!url) return;
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN && url.startsWith('http')) {
      await del(url);
    } else if (!process.env.BLOB_READ_WRITE_TOKEN && url.startsWith('/uploads/')) {
      const filename = url.replace('/uploads/', '');
      const filepath = path.join(process.cwd(), 'uploads', filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    }
  } catch (error) {
    console.error(`Failed to delete file at ${url}:`, error);
  }
}

async function getFileBase64(url: string, filename: string): Promise<{ base64: string, mimeType: string }> {
  let base64 = '';
  let mimeType = filename.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
  
  if (url.startsWith('/uploads/')) {
    const filepath = path.join(process.cwd(), url);
    if (fs.existsSync(filepath)) {
      base64 = fs.readFileSync(filepath).toString('base64');
    }
  } else if (url.startsWith('http')) {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    base64 = Buffer.from(arrayBuffer).toString('base64');
    mimeType = res.headers.get('content-type') || mimeType;
  }
  return { base64, mimeType };
}

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
const upload = multer({ storage: multer.memoryStorage() });

// --- API Routes ---

// 1. Sessions
app.get('/api/sessions', async (req, res) => {
  try {
    await initDb();
    let sessions;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM sessions ORDER BY created_at DESC`;
      sessions = rows;
    } else {
      sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
    }
    
    sessions = sessions.map((s: any) => ({
      ...s,
      course_materials: s.course_materials ? JSON.parse(s.course_materials) : []
    }));
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch sessions', details: error.message });
  }
});

app.post('/api/sessions', upload.fields([
  { name: 'assignment', maxCount: 1 },
  { name: 'modelAnswer', maxCount: 1 },
  { name: 'courseMaterials' }
]), async (req, res) => {
  try {
    await initDb();
    const { id, name, genericInstructions, llmModel } = req.body;
    const files = (req.files as { [fieldname: string]: Express.Multer.File[] }) || {};
    
    const assignmentFile = files['assignment']?.[0];
    const modelAnswerFile = files['modelAnswer']?.[0];
    const courseMaterialsFiles = files['courseMaterials'] || [];

    if (!assignmentFile) throw new Error("Assignment file is required");

    const assignmentUrl = await uploadFile(assignmentFile);
    const assignmentFilename = assignmentFile.originalname;

    let modelAnswerUrl = null;
    let modelAnswerFilename = null;
    if (modelAnswerFile) {
      modelAnswerUrl = await uploadFile(modelAnswerFile);
      modelAnswerFilename = modelAnswerFile.originalname;
    }

    const courseMaterials = [];
    for (const file of courseMaterialsFiles) {
      courseMaterials.push({
        url: await uploadFile(file),
        filename: file.originalname
      });
    }

    const cmJson = JSON.stringify(courseMaterials);
    const modelToUse = llmModel || 'gemini-3.1-pro-preview';

    if (process.env.POSTGRES_URL) {
      await sql`
        INSERT INTO sessions (id, name, assignment_url, assignment_filename, model_answer_url, model_answer_filename, course_materials, generic_instructions, llm_model)
        VALUES (${id}, ${name}, ${assignmentUrl}, ${assignmentFilename}, ${modelAnswerUrl}, ${modelAnswerFilename}, ${cmJson}, ${genericInstructions || ''}, ${modelToUse})
      `;
    } else {
      db.prepare(`
        INSERT INTO sessions (id, name, assignment_url, assignment_filename, model_answer_url, model_answer_filename, course_materials, generic_instructions, llm_model)
        VALUES (@id, @name, @assignmentUrl, @assignmentFilename, @modelAnswerUrl, @modelAnswerFilename, @cmJson, @genericInstructions, @llmModel)
      `).run({ id, name, assignmentUrl, assignmentFilename, modelAnswerUrl, modelAnswerFilename, cmJson, genericInstructions: genericInstructions || '', llmModel: modelToUse });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create session', details: error.message });
  }
});

app.patch('/api/sessions/:sessionId', upload.fields([
  { name: 'assignment', maxCount: 1 },
  { name: 'modelAnswer', maxCount: 1 },
  { name: 'courseMaterials' }
]), async (req, res) => {
  try {
    await initDb();
    const { sessionId } = req.params;
    const { genericInstructions, llmModel, deleteModelAnswer, deletedCourseMaterials } = req.body;
    const files = (req.files as { [fieldname: string]: Express.Multer.File[] }) || {};
    
    // Fetch current session to get old URLs
    let session;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
      session = rows[0];
    } else {
      session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    }
    if (!session) throw new Error("Session not found");

    const assignmentFile = files['assignment']?.[0];
    const modelAnswerFile = files['modelAnswer']?.[0];
    const courseMaterialsFiles = files['courseMaterials'] || [];

    let updateFields: string[] = [];
    let queryParams: any = { id: sessionId };
    let pgValues: any[] = [];
    let pgSetClauses: string[] = [];

    if (assignmentFile) {
      if (session.assignment_url) await deleteFile(session.assignment_url);
      const assignmentUrl = await uploadFile(assignmentFile);
      const assignmentFilename = assignmentFile.originalname;
      updateFields.push('assignment_url = @assignmentUrl', 'assignment_filename = @assignmentFilename');
      queryParams.assignmentUrl = assignmentUrl;
      queryParams.assignmentFilename = assignmentFilename;
      
      pgSetClauses.push(`assignment_url = $${pgValues.length + 1}`);
      pgValues.push(assignmentUrl);
      pgSetClauses.push(`assignment_filename = $${pgValues.length + 1}`);
      pgValues.push(assignmentFilename);
    }

    if (modelAnswerFile) {
      if (session.model_answer_url) await deleteFile(session.model_answer_url);
      const modelAnswerUrl = await uploadFile(modelAnswerFile);
      const modelAnswerFilename = modelAnswerFile.originalname;
      updateFields.push('model_answer_url = @modelAnswerUrl', 'model_answer_filename = @modelAnswerFilename');
      queryParams.modelAnswerUrl = modelAnswerUrl;
      queryParams.modelAnswerFilename = modelAnswerFilename;
      
      pgSetClauses.push(`model_answer_url = $${pgValues.length + 1}`);
      pgValues.push(modelAnswerUrl);
      pgSetClauses.push(`model_answer_filename = $${pgValues.length + 1}`);
      pgValues.push(modelAnswerFilename);
    } else if (deleteModelAnswer === 'true') {
      if (session.model_answer_url) await deleteFile(session.model_answer_url);
      updateFields.push('model_answer_url = NULL', 'model_answer_filename = NULL');
      pgSetClauses.push(`model_answer_url = NULL`);
      pgSetClauses.push(`model_answer_filename = NULL`);
    }

    // Handle course materials
    let currentMaterials: any[] = [];
    if (courseMaterialsFiles.length > 0 || deletedCourseMaterials) {
      if (session && session.course_materials) {
        currentMaterials = JSON.parse(session.course_materials);
      }

      // Remove deleted materials
      if (deletedCourseMaterials) {
        let deletedUrls: string[] = [];
        try {
          deletedUrls = JSON.parse(deletedCourseMaterials);
        } catch (e) {
          if (typeof deletedCourseMaterials === 'string') deletedUrls = [deletedCourseMaterials];
        }
        
        for (const url of deletedUrls) {
          await deleteFile(url);
        }
        currentMaterials = currentMaterials.filter(m => !deletedUrls.includes(m.url));
      }

      // Add new materials
      for (const file of courseMaterialsFiles) {
        currentMaterials.push({
          url: await uploadFile(file),
          filename: file.originalname
        });
      }

      const cmJson = JSON.stringify(currentMaterials);
      updateFields.push('course_materials = @cmJson');
      queryParams.cmJson = cmJson;
      
      pgSetClauses.push(`course_materials = $${pgValues.length + 1}`);
      pgValues.push(cmJson);
    }

    if (genericInstructions !== undefined) {
      updateFields.push('generic_instructions = @genericInstructions');
      queryParams.genericInstructions = genericInstructions;
      
      pgSetClauses.push(`generic_instructions = $${pgValues.length + 1}`);
      pgValues.push(genericInstructions);
    }

    if (llmModel !== undefined) {
      updateFields.push('llm_model = @llmModel');
      queryParams.llmModel = llmModel;
      
      pgSetClauses.push(`llm_model = $${pgValues.length + 1}`);
      pgValues.push(llmModel);
    }

    if (updateFields.length === 0) {
      return res.json({ success: true, message: "No fields to update." });
    }

    if (process.env.POSTGRES_URL) {
      pgValues.push(sessionId);
      const query = `UPDATE sessions SET ${pgSetClauses.join(', ')} WHERE id = $${pgValues.length}`;
      await sql.query(query, pgValues);
    } else {
      const query = `UPDATE sessions SET ${updateFields.join(', ')} WHERE id = @id`;
      db.prepare(query).run(queryParams);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update session', details: error.message });
  }
});

// 2. Students
app.get('/api/sessions/:sessionId/students', async (req, res) => {
  try {
    await initDb();
    const { sessionId } = req.params;
    let students;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM students WHERE session_id = ${sessionId}`;
      students = rows;
    } else {
      students = db.prepare('SELECT * FROM students WHERE session_id = ?').all(sessionId);
    }
    res.json(students);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch students', details: error.message });
  }
});

app.post('/api/sessions/:sessionId/students', upload.single('solution'), async (req, res) => {
  try {
    await initDb();
    const { sessionId } = req.params;
    const { id, name, student_id } = req.body;
    const solutionFile = req.file;

    if (!solutionFile) throw new Error("Solution file is required");

    const solutionUrl = await uploadFile(solutionFile);
    const solutionFilename = solutionFile.originalname;

    if (process.env.POSTGRES_URL) {
      await sql`
        INSERT INTO students (id, session_id, name, student_id, solution_url, solution_filename, status)
        VALUES (${id}, ${sessionId}, ${name || ''}, ${student_id || ''}, ${solutionUrl}, ${solutionFilename}, 'idle')
      `;
    } else {
      db.prepare(`
        INSERT INTO students (id, session_id, name, student_id, solution_url, solution_filename, status)
        VALUES (@id, @sessionId, @name, @student_id, @solutionUrl, @solutionFilename, 'idle')
      `).run({ id, sessionId, name: name || '', student_id: student_id || '', solutionUrl, solutionFilename });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add student', details: error.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const updates = req.body;
    
    if (process.env.POSTGRES_URL) {
      if (updates.name !== undefined) await sql`UPDATE students SET name = ${updates.name} WHERE id = ${id}`;
      if (updates.student_id !== undefined) await sql`UPDATE students SET student_id = ${updates.student_id} WHERE id = ${id}`;
      if (updates.status !== undefined) await sql`UPDATE students SET status = ${updates.status} WHERE id = ${id}`;
      if (updates.feedback !== undefined) await sql`UPDATE students SET feedback = ${updates.feedback} WHERE id = ${id}`;
      if (updates.grade !== undefined) await sql`UPDATE students SET grade = ${updates.grade} WHERE id = ${id}`;
      if (updates.justification !== undefined) await sql`UPDATE students SET justification = ${updates.justification} WHERE id = ${id}`;
    } else {
      const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
      if (setClause) {
        db.prepare(`UPDATE students SET ${setClause} WHERE id = @id`).run({ ...updates, id });
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update student', details: error.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    
    // Fetch student to get the solution URL
    let student;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT solution_url FROM students WHERE id = ${id}`;
      student = rows[0];
    } else {
      student = db.prepare('SELECT solution_url FROM students WHERE id = ?').get(id);
    }

    if (student && student.solution_url) {
      await deleteFile(student.solution_url);
    }

    if (process.env.POSTGRES_URL) {
      await sql`DELETE FROM students WHERE id = ${id}`;
    } else {
      db.prepare('DELETE FROM students WHERE id = ?').run(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete student', details: error.message });
  }
});

// 3. Grading
app.post('/api/students/:id/grade', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const { feedback } = req.body;

    // Fetch student
    let student;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM students WHERE id = ${id}`;
      student = rows[0];
    } else {
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    }
    if (!student) throw new Error("Student not found");

    // Fetch session
    let session;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM sessions WHERE id = ${student.session_id}`;
      session = rows[0];
    } else {
      session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(student.session_id);
    }
    if (!session) throw new Error("Session not found");

    // Update status to grading
    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'grading' WHERE id = ${id}`;
    } else {
      db.prepare(`UPDATE students SET status = 'grading' WHERE id = ?`).run(id);
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const parts: any[] = [];

    // 1. Assignment
    const assignFile = await getFileBase64(session.assignment_url, session.assignment_filename);
    parts.push({ text: "--- ASSIGNMENT & RUBRIC ---" });
    parts.push({ inlineData: { data: assignFile.base64, mimeType: assignFile.mimeType } });

    // 2. Model Answer
    if (session.model_answer_url) {
      const modelFile = await getFileBase64(session.model_answer_url, session.model_answer_filename);
      parts.push({ text: "--- MODEL ANSWER ---" });
      parts.push({ inlineData: { data: modelFile.base64, mimeType: modelFile.mimeType } });
    }

    // 3. Course Materials
    const courseMaterials = session.course_materials ? (typeof session.course_materials === 'string' ? JSON.parse(session.course_materials) : session.course_materials) : [];
    if (courseMaterials.length > 0) {
      parts.push({ text: "--- COURSE MATERIALS ---" });
      for (const cm of courseMaterials) {
        const cmFile = await getFileBase64(cm.url, cm.filename);
        parts.push({ inlineData: { data: cmFile.base64, mimeType: cmFile.mimeType } });
      }
    }

    // 4. Student Solution
    const solFile = await getFileBase64(student.solution_url, student.solution_filename);
    parts.push({ text: `--- STUDENT SOLUTION (Name: ${student.name}, ID: ${student.student_id}) ---` });
    parts.push({ inlineData: { data: solFile.base64, mimeType: solFile.mimeType } });

    let promptText = `You are an expert academic grader. Grade the provided student solution based on the assignment instructions, rubric, and optionally the model answer and course materials. Provide a recommended grade and a detailed justification.`;
    if (session.generic_instructions?.trim()) {
      promptText += `\n\nGeneral Instructions for Grading:\n"${session.generic_instructions}"`;
    }
    if (feedback?.trim()) {
      promptText += `\n\nInstructor Feedback for Re-grading:\n"${feedback}"`;
    }
    parts.push({ text: promptText });

    // CHANGED MODEL TO gemini-3.1-pro-preview as default
    let modelToUse = session.llm_model || 'gemini-3.1-pro-preview';
    if (modelToUse === 'gemini-3.1-flash-preview') {
      modelToUse = 'gemini-3.1-flash-lite-preview';
    } else if (modelToUse === 'gemini-3.0-pro-preview') {
      modelToUse = 'gemini-3-pro-preview';
    }
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            grade: { type: Type.STRING },
            justification: { type: Type.STRING },
          },
          required: ["grade", "justification"],
        },
      },
    });

    let rawText = response.text?.trim() || "{}";
    rawText = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    let result;
    try {
      result = JSON.parse(rawText);
    } catch (parseError) {
      throw new Error("AI returned invalid JSON format.");
    }

    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'graded', grade = ${result.grade}, justification = ${result.justification} WHERE id = ${id}`;
    } else {
      db.prepare(`UPDATE students SET status = 'graded', grade = @grade, justification = @justification WHERE id = @id`)
        .run({ id, grade: result.grade, justification: result.justification });
    }

    res.json({ success: true, grade: result.grade, justification: result.justification });

  } catch (error: any) {
    console.error('Grading error:', error);
    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'error' WHERE id = ${req.params.id}`.catch(console.error);
    } else {
      db?.prepare(`UPDATE students SET status = 'error' WHERE id = ?`).run(req.params.id);
    }
    res.status(500).json({ 
      error: 'Grading failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

// 4. Batch Grading
app.post('/api/sessions/:sessionId/grade-all', async (req, res) => {
  try {
    await initDb();
    const { sessionId } = req.params;
    const { feedback, regradeAll } = req.body;

    // Fetch session
    let session;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
      session = rows[0];
    } else {
      session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    }
    if (!session) throw new Error("Session not found");

    // Fetch students to grade
    let students;
    if (process.env.POSTGRES_URL) {
      if (regradeAll) {
        const { rows } = await sql`SELECT * FROM students WHERE session_id = ${sessionId}`;
        students = rows;
      } else {
        const { rows } = await sql`SELECT * FROM students WHERE session_id = ${sessionId} AND status IN ('idle', 'error')`;
        students = rows;
      }
    } else {
      if (regradeAll) {
        students = db.prepare(`SELECT * FROM students WHERE session_id = ?`).all(sessionId);
      } else {
        students = db.prepare(`SELECT * FROM students WHERE session_id = ? AND status IN ('idle', 'error')`).all(sessionId);
      }
    }

    if (students.length === 0) {
      return res.json({ success: true, message: "No students to grade." });
    }

    // Update status to grading
    if (process.env.POSTGRES_URL) {
      if (regradeAll) {
        await sql`UPDATE students SET status = 'grading' WHERE session_id = ${sessionId}`;
      } else {
        await sql`UPDATE students SET status = 'grading' WHERE session_id = ${sessionId} AND status IN ('idle', 'error')`;
      }
    } else {
      if (regradeAll) {
        db.prepare(`UPDATE students SET status = 'grading' WHERE session_id = ?`).run(sessionId);
      } else {
        db.prepare(`UPDATE students SET status = 'grading' WHERE session_id = ? AND status IN ('idle', 'error')`).run(sessionId);
      }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const parts: any[] = [];

    // 1. Assignment
    const assignFile = await getFileBase64(session.assignment_url, session.assignment_filename);
    parts.push({ text: "--- ASSIGNMENT & RUBRIC ---" });
    parts.push({ inlineData: { data: assignFile.base64, mimeType: assignFile.mimeType } });

    // 2. Model Answer
    if (session.model_answer_url) {
      const modelFile = await getFileBase64(session.model_answer_url, session.model_answer_filename);
      parts.push({ text: "--- MODEL ANSWER ---" });
      parts.push({ inlineData: { data: modelFile.base64, mimeType: modelFile.mimeType } });
    }

    // 3. Course Materials
    const courseMaterials = session.course_materials ? (typeof session.course_materials === 'string' ? JSON.parse(session.course_materials) : session.course_materials) : [];
    if (courseMaterials.length > 0) {
      parts.push({ text: "--- COURSE MATERIALS ---" });
      for (const cm of courseMaterials) {
        const cmFile = await getFileBase64(cm.url, cm.filename);
        parts.push({ inlineData: { data: cmFile.base64, mimeType: cmFile.mimeType } });
      }
    }

    // 4. Student Solutions
    parts.push({ text: "--- STUDENT SOLUTIONS ---" });
    for (const student of students) {
      const solFile = await getFileBase64(student.solution_url, student.solution_filename);
      parts.push({ text: `--- START OF STUDENT SOLUTION (ID: ${student.id}, Name: ${student.name}, StudentID: ${student.student_id}) ---` });
      parts.push({ inlineData: { data: solFile.base64, mimeType: solFile.mimeType } });
      parts.push({ text: `--- END OF STUDENT SOLUTION (ID: ${student.id}) ---` });
    }

    let promptText = `You are an expert academic grader. Grade ALL the provided student solutions based on the assignment instructions, rubric, and optionally the model answer and course materials. Provide a recommended grade and a detailed justification for EACH student.`;
    if (session.generic_instructions?.trim()) {
      promptText += `\n\nGeneral Instructions for Grading:\n"${session.generic_instructions}"`;
    }
    if (feedback?.trim()) {
      promptText += `\n\nInstructor Feedback for Re-grading:\n"${feedback}"`;
    }
    parts.push({ text: promptText });

    let modelToUse = session.llm_model || 'gemini-3.1-pro-preview';
    if (modelToUse === 'gemini-3.1-flash-preview') {
      modelToUse = 'gemini-3.1-flash-lite-preview';
    } else if (modelToUse === 'gemini-3.0-pro-preview') {
      modelToUse = 'gemini-3-pro-preview';
    }
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "The exact ID of the student provided in the prompt (e.g., the UUID)" },
              grade: { type: Type.STRING },
              justification: { type: Type.STRING },
            },
            required: ["id", "grade", "justification"],
          }
        },
      },
    });

    let rawText = response.text?.trim() || "[]";
    rawText = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    let results: any[] = [];
    try {
      results = JSON.parse(rawText);
    } catch (parseError) {
      throw new Error("AI returned invalid JSON format.");
    }

    // Update each student
    for (const result of results) {
      if (process.env.POSTGRES_URL) {
        await sql`UPDATE students SET status = 'graded', grade = ${result.grade}, justification = ${result.justification} WHERE id = ${result.id}`;
      } else {
        db.prepare(`UPDATE students SET status = 'graded', grade = @grade, justification = @justification WHERE id = @id`)
          .run({ id: result.id, grade: result.grade, justification: result.justification });
      }
    }

    // Mark any students that weren't in the results as error
    const gradedIds = results.map(r => r.id);
    for (const student of students) {
      if (!gradedIds.includes(student.id)) {
         if (process.env.POSTGRES_URL) {
            await sql`UPDATE students SET status = 'error', feedback = 'AI failed to return a grade for this student.' WHERE id = ${student.id}`;
         } else {
            db.prepare(`UPDATE students SET status = 'error', feedback = 'AI failed to return a grade for this student.' WHERE id = ?`).run(student.id);
         }
      }
    }

    res.json({ success: true, results });

  } catch (error: any) {
    console.error('Batch Grading error:', error);
    // Revert status to error
    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'error' WHERE session_id = ${req.params.sessionId} AND status = 'grading'`.catch(console.error);
    } else {
      db?.prepare(`UPDATE students SET status = 'error' WHERE session_id = ? AND status = 'grading'`).run(req.params.sessionId);
    }
    res.status(500).json({ 
      error: 'Batch Grading failed', 
      details: error instanceof Error ? error.message : String(error) 
    });
  }
});

app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.path });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Failed to load vite dynamically", e);
    }
  } else {
    app.use(express.static('dist'));
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
