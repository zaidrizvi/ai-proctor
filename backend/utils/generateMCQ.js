import { GoogleGenAI } from "@google/genai";

const MODELS = [
   "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
];

const generateMCQ = async (subject, topic, count = 10) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Generate ${count} multiple choice questions for the subject "${subject}" on the topic "${topic}".

Return ONLY a valid JSON array, no markdown, no explanation, no backticks. Just raw JSON.

Format:
[
  {
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0,
    "explanation": "Brief explanation why this is correct"
  }
]

Rules:
- correctAnswer is the index (0-3) of the correct option
- All 4 options must be plausible
- Questions should be clear and unambiguous
- Difficulty should be mixed (easy, medium, hard)`;

  let lastError;

  for (const modelName of MODELS) {
    try {
      console.log(`Trying model: ${modelName}`);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });

      const text = response.text.trim();
      const cleaned = text.replace(/```json|```/g, "").trim();
      const questions = JSON.parse(cleaned);

      if (!Array.isArray(questions)) throw new Error("Gemini did not return array");

      console.log(`✅ Success with model: ${modelName}`);

      return questions.map((q) => ({
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation || "",
      }));

    } catch (err) {
      console.log(`❌ Model ${modelName} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
};

export default generateMCQ;