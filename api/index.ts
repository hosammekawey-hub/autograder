import express from 'express';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import { put } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

// --- Debug Logging Middleware ---
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
      // Initialize Vercel Postgres Table
      await sql`
        CREATE TABLE IF NOT EXISTS students (
          id VARCHAR(255) PRIMARY KEY,
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
      console.log("Vercel Postgres connected and table verified.");
    } else {
      console.log("Connecting to Local SQLite...");
      // Initialize Local SQLite dynamically so it doesn't crash Vercel
      const Database = (await import('better-sqlite3')).default;
      db = new Database('autograder.db');
      db.exec(`
        CREATE TABLE IF NOT EXISTS students (
          id TEXT PRIMARY KEY,
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
      console.log("Local SQLite connected.");
    }
    isDbInitialized = true;
  } catch (error: any) {
    console.error('Database initialization error:', error);
    throw error; // Throw so the API routes can catch it and return a 500 JSON response
  }
}

// --- Storage Setup ---
async function uploadFile(file: Express.Multer.File): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(file.originalname, file.buffer, { access: 'public' });
    return blob.url;
  } else {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const filename = `${Date.now()}-${file.originalname}`;
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, file.buffer);
    return `/uploads/${filename}`;
  }
}

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// --- API Routes ---
const upload = multer({ storage: multer.memoryStorage() });

app.get('/api/students', async (req, res) => {
  try {
    await initDb();
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM students`;
      res.json(rows);
    } else {
      const students = db.prepare('SELECT * FROM students').all();
      res.json(students);
    }
  } catch (error: any) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Failed to fetch students', details: error.message });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    await initDb();
    const { id, name, student_id, status } = req.body;
    const safeName = name || '';
    const safeStudentId = student_id || '';
    const safeStatus = status || 'idle';

    if (process.env.POSTGRES_URL) {
      await sql`
        INSERT INTO students (id, name, student_id, status)
        VALUES (${id}, ${safeName}, ${safeStudentId}, ${safeStatus})
      `;
    } else {
      db.prepare(`
        INSERT INTO students (id, name, student_id, status)
        VALUES (@id, @name, @student_id, @status)
      `).run({ id, name: safeName, student_id: safeStudentId, status: safeStatus });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error adding student:', error);
    res.status(500).json({ error: 'Failed to add student', details: error.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const updates = req.body;
    
    if (process.env.POSTGRES_URL) {
      // Dynamic update for Postgres
      if (updates.name !== undefined) await sql`UPDATE students SET name = ${updates.name} WHERE id = ${id}`;
      if (updates.student_id !== undefined) await sql`UPDATE students SET student_id = ${updates.student_id} WHERE id = ${id}`;
      if (updates.status !== undefined) await sql`UPDATE students SET status = ${updates.status} WHERE id = ${id}`;
      if (updates.feedback !== undefined) await sql`UPDATE students SET feedback = ${updates.feedback} WHERE id = ${id}`;
      if (updates.grade !== undefined) await sql`UPDATE students SET grade = ${updates.grade} WHERE id = ${id}`;
      if (updates.justification !== undefined) await sql`UPDATE students SET justification = ${updates.justification} WHERE id = ${id}`;
      if (updates.solution_url !== undefined) await sql`UPDATE students SET solution_url = ${updates.solution_url} WHERE id = ${id}`;
      if (updates.solution_filename !== undefined) await sql`UPDATE students SET solution_filename = ${updates.solution_filename} WHERE id = ${id}`;
    } else {
      const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
      if (setClause) {
        db.prepare(`UPDATE students SET ${setClause} WHERE id = @id`).run({ ...updates, id });
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Failed to update student', details: error.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    if (process.env.POSTGRES_URL) {
      await sql`DELETE FROM students WHERE id = ${id}`;
    } else {
      db.prepare('DELETE FROM students WHERE id = ?').run(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student', details: error.message });
  }
});

app.post('/api/students/:id/grade', upload.fields([
  { name: 'assignment', maxCount: 1 },
  { name: 'modelAnswer', maxCount: 1 },
  { name: 'courseMaterials' },
  { name: 'solution', maxCount: 1 }
]), async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const { genericInstructions, feedback, studentName, studentId } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    const assignmentFile = files['assignment']?.[0];
    const modelAnswerFile = files['modelAnswer']?.[0];
    const courseMaterials = files['courseMaterials'] || [];
    const solutionFile = files['solution']?.[0];

    // Get existing student record
    let student: any;
    if (process.env.POSTGRES_URL) {
      const { rows } = await sql`SELECT * FROM students WHERE id = ${id}`;
      student = rows[0];
    } else {
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    }

    if (!assignmentFile) {
      return res.status(400).json({ error: 'Assignment file is required.' });
    }
    if (!solutionFile && !student?.solution_url) {
      return res.status(400).json({ error: 'Solution file is required.' });
    }

    let solutionUrl = student?.solution_url;
    let solutionFilename = student?.solution_filename;
    let solutionMimeType = 'application/pdf';
    let solutionBase64 = '';

    if (solutionFile) {
      solutionUrl = await uploadFile(solutionFile);
      solutionFilename = solutionFile.originalname;
      solutionMimeType = solutionFile.mimetype;
      solutionBase64 = solutionFile.buffer.toString('base64');
    } else if (solutionUrl && solutionUrl.startsWith('/uploads/')) {
      const filepath = path.join(process.cwd(), solutionUrl);
      if (fs.existsSync(filepath)) {
        const buffer = fs.readFileSync(filepath);
        solutionBase64 = buffer.toString('base64');
        solutionMimeType = solutionFilename?.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
      }
    } else if (solutionUrl && solutionUrl.startsWith('http')) {
      const blobRes = await fetch(solutionUrl);
      const arrayBuffer = await blobRes.arrayBuffer();
      solutionBase64 = Buffer.from(arrayBuffer).toString('base64');
      solutionMimeType = blobRes.headers.get('content-type') || 'application/pdf';
    }

    // Update DB to show grading in progress
    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'grading', solution_url = ${solutionUrl}, solution_filename = ${solutionFilename} WHERE id = ${id}`;
    } else {
      db.prepare(`UPDATE students SET status = 'grading', solution_url = @url, solution_filename = @filename WHERE id = @id`)
        .run({ id, url: solutionUrl, filename: solutionFilename });
    }

    // Initialize Gemini
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const parts: any[] = [];
    
    parts.push({ text: "--- ASSIGNMENT & RUBRIC ---" });
    parts.push({ inlineData: { data: assignmentFile.buffer.toString('base64'), mimeType: assignmentFile.mimetype } });

    if (modelAnswerFile) {
      parts.push({ text: "--- MODEL ANSWER ---" });
      parts.push({ inlineData: { data: modelAnswerFile.buffer.toString('base64'), mimeType: modelAnswerFile.mimetype } });
    }

    if (courseMaterials.length > 0) {
      parts.push({ text: "--- COURSE MATERIALS ---" });
      for (const file of courseMaterials) {
        parts.push({ inlineData: { data: file.buffer.toString('base64'), mimeType: file.mimetype } });
      }
    }

    parts.push({ text: `--- STUDENT SOLUTION (Name: ${studentName}, ID: ${studentId}) ---` });
    parts.push({ inlineData: { data: solutionBase64, mimeType: solutionMimeType } });

    let promptText = `You are an expert academic grader. Your task is to grade the provided student solution based on the assignment instructions, rubric, and optionally the model answer and course materials. Please provide a recommended grade and a detailed justification for the grade.`;

    if (genericInstructions?.trim()) {
      promptText += `\n\nGeneral Instructions for Grading:\n"${genericInstructions}"`;
    }

    if (feedback?.trim()) {
      promptText += `\n\nAdditionally, the instructor has provided the following feedback to revise the grading for this student. Please adjust your grading and justification accordingly:\n"${feedback}"`;
    }

    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
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

    const result = JSON.parse(response.text?.trim() || "{}");

    // Update DB with results
    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'graded', grade = ${result.grade}, justification = ${result.justification} WHERE id = ${id}`;
    } else {
      db.prepare(`UPDATE students SET status = 'graded', grade = @grade, justification = @justification WHERE id = @id`)
        .run({ id, grade: result.grade, justification: result.justification });
    }

    res.json({ success: true, grade: result.grade, justification: result.justification, solutionUrl, solutionFilename });

  } catch (error: any) {
    console.error('Grading error:', error);
    if (process.env.POSTGRES_URL) {
      await sql`UPDATE students SET status = 'error' WHERE id = ${req.params.id}`;
    } else {
      db.prepare(`UPDATE students SET status = 'error' WHERE id = ?`).run(req.params.id);
    }
    res.status(500).json({ error: 'Grading failed', details: error.message });
  }
});

// --- Catch-all API Error Handler ---
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.path });
});

// --- Vite Middleware ---
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
