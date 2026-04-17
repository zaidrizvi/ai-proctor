import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
];

class MCQGenerationError extends Error {
  constructor(message, statusCode = 502, details = {}) {
    super(message);
    this.name = "MCQGenerationError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getModelList = () => {
  const configured = process.env.GEMINI_MODELS?.trim();
  if (!configured) {
    return DEFAULT_MODELS;
  }

  return configured
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
};

const buildPrompt = (subject, topic, count) => `You are an expert exam paper setter and subject-matter teacher.

Create exactly ${count} high-quality multiple choice questions for:
- Subject: "${subject}"
- Topic: "${topic}"

Return ONLY a valid JSON array. Do not include markdown, comments, code fences, headings, or any text outside the JSON.

Required JSON schema:
[
  {
    "question": "A clear, exam-ready question stem?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": 0,
    "explanation": "A concise explanation of why the correct option is correct."
  }
]

Quality requirements:
- Generate exactly ${count} questions. Do not generate fewer or more.
- Each question must test meaningful understanding of "${topic}", not trivia or vague definitions.
- Cover a balanced mix of concepts, applications, comparisons, and common misconceptions.
- Use mixed difficulty: about 30% easy, 50% medium, and 20% hard.
- Write self-contained question stems. A student should not need outside context beyond the subject and topic.
- Make every option plausible to a student who has partially studied the topic.
- Make the wrong options believable, but clearly incorrect for one specific reason.
- Avoid trick questions, ambiguous wording, opinion-based questions, and questions with multiple valid answers.
- Avoid repeated question patterns. Do not ask the same concept in different wording.
- Avoid giveaway phrases such as "always", "never", "all of the above", "none of the above", or obviously longer correct answers.
- Keep options similar in length, grammar, and style.
- Randomize the correct answer position across questions.
- correctAnswer must be the zero-based index (0, 1, 2, or 3) of the correct option.
- Explanations must be short, accurate, and useful for review.
- Use professional academic language appropriate for an online exam.
- Do not mention difficulty labels in the question, options, or explanation.
- Do not include answer letters like "A.", "B.", "C.", or "D." inside the options.
- Ensure the JSON is parseable by JSON.parse with double-quoted strings and no trailing commas.`;

const parseProviderError = (err) => {
  const rawMessage = String(err?.message || err || "");
  const match = rawMessage.match(/\{.*\}$/s);
  const payloadText = match ? match[0] : rawMessage;

  try {
    const parsed = JSON.parse(payloadText);
    const providerError = parsed?.error || {};
    return {
      code: providerError.code,
      status: providerError.status,
      message: providerError.message || rawMessage,
    };
  } catch {
    return {
      code: undefined,
      status: undefined,
      message: rawMessage,
    };
  }
};

const normalizeQuestions = (questions) => {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new MCQGenerationError("AI question generation returned an empty or invalid question list.");
  }

  return questions.map((q, index) => {
    const options = Array.isArray(q?.options) ? q.options.map((option) => String(option || "").trim()) : [];
    const correctAnswer = Number(q?.correctAnswer);

    if (!String(q?.question || "").trim()) {
      throw new MCQGenerationError(`AI question ${index + 1} is missing its prompt.`);
    }
    if (options.length !== 4 || options.some((option) => !option)) {
      throw new MCQGenerationError(`AI question ${index + 1} must have exactly 4 filled options.`);
    }
    if (![0, 1, 2, 3].includes(correctAnswer)) {
      throw new MCQGenerationError(`AI question ${index + 1} must have a valid correct answer index.`);
    }

    return {
      question: String(q.question).trim(),
      options,
      correctAnswer,
      explanation: String(q?.explanation || "").trim(),
    };
  });
};

const generateMCQ = async (subject, topic, count = 10) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new MCQGenerationError("GEMINI_API_KEY is missing.", 500);
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(subject, topic, count);
  const models = getModelList();
  let lastErrorMessage = "Unknown Gemini error";

  for (const modelName of models) {
    try {
      console.log(`Trying model: ${modelName}`);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });

      const text = response.text?.trim?.() || "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      const questions = JSON.parse(cleaned);

      console.log(`Success with model: ${modelName}`);
      return normalizeQuestions(questions);
    } catch (err) {
      const providerError = parseProviderError(err);
      lastErrorMessage = providerError.message || String(err?.message || err);
      console.log(`Model ${modelName} failed: ${lastErrorMessage}`);

      if (providerError.status === "PERMISSION_DENIED") {
        throw new MCQGenerationError(
          "Gemini API key is invalid or has been disabled/leaked. Update GEMINI_API_KEY and try again.",
          503,
          { model: modelName, providerStatus: providerError.status, providerCode: providerError.code }
        );
      }

      if (providerError.status === "RESOURCE_EXHAUSTED") {
        throw new MCQGenerationError(
          "Gemini API quota is exhausted for this project/key. Check billing, quotas, or switch to a different API key.",
          503,
          { model: modelName, providerStatus: providerError.status, providerCode: providerError.code }
        );
      }

      if (providerError.status === "NOT_FOUND") {
        continue;
      }
    }
  }

  throw new MCQGenerationError(
    `All configured Gemini models failed. Last error: ${lastErrorMessage}`,
    503
  );
};

export { MCQGenerationError };
export default generateMCQ;
