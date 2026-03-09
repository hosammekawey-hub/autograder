import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
}

export async function gradeAssignment(
  assignmentFile: File,
  modelAnswerFile: File | null,
  courseMaterials: File[],
  studentSolutionFile: File,
  studentName: string,
  studentId: string,
  feedback: string | null,
  genericInstructions: string
): Promise<{ grade: string; justification: string }> {
  
  const parts: any[] = [];

  // 1. Add Assignment
  const assignmentBase64 = await fileToBase64(assignmentFile);
  parts.push({ text: "--- ASSIGNMENT & RUBRIC ---" });
  parts.push({
    inlineData: {
      data: assignmentBase64,
      mimeType: assignmentFile.type,
    },
  });

  // 2. Add Model Answer (if any)
  if (modelAnswerFile) {
    const modelAnswerBase64 = await fileToBase64(modelAnswerFile);
    parts.push({ text: "--- MODEL ANSWER ---" });
    parts.push({
      inlineData: {
        data: modelAnswerBase64,
        mimeType: modelAnswerFile.type,
      },
    });
  }

  // 3. Add Course Materials
  if (courseMaterials.length > 0) {
    parts.push({ text: "--- COURSE MATERIALS ---" });
    for (const file of courseMaterials) {
      const base64 = await fileToBase64(file);
      parts.push({
        inlineData: {
          data: base64,
          mimeType: file.type,
        },
      });
    }
  }

  // 4. Add Student Solution
  const solutionBase64 = await fileToBase64(studentSolutionFile);
  parts.push({ text: `--- STUDENT SOLUTION (Name: ${studentName}, ID: ${studentId}) ---` });
  parts.push({
    inlineData: {
      data: solutionBase64,
      mimeType: studentSolutionFile.type,
    },
  });

  // 5. Add Instructions
  let promptText = `
You are an expert academic grader. Your task is to grade the provided student solution based on the assignment instructions, rubric, and optionally the model answer and course materials.

Please provide a recommended grade and a detailed justification for the grade.
`;

  if (genericInstructions.trim()) {
    promptText += `\n\nGeneral Instructions for Grading:\n"${genericInstructions}"`;
  }

  if (feedback) {
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
          grade: {
            type: Type.STRING,
            description: "The recommended grade (e.g., '85/100', 'A-', 'Pass').",
          },
          justification: {
            type: Type.STRING,
            description: "A detailed justification explaining why this grade was given, referencing the rubric and the student's work.",
          },
        },
        required: ["grade", "justification"],
      },
    },
  });

  const jsonStr = response.text?.trim() || "{}";
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse JSON response", e);
    return { grade: "Error", justification: "Failed to parse the grading response." };
  }
}
