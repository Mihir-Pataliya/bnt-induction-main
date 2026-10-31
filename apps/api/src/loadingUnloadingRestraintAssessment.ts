export const LURC_QUESTION_COUNT = 10;

export interface LurcAssessmentQuestion {
  id: string;
  question: string;
  options: unknown;
  correct_answer: number;
}

interface ValidLurcAssessmentQuestion extends LurcAssessmentQuestion {
  options: string[];
}

export type LurcAssessmentErrorKind = "configuration" | "answers";

export interface LurcAttemptRecord {
  id: string;
  user_id: string;
}

export interface LurcAnswerReview {
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
}

export class LurcAssessmentError extends Error {
  constructor(
    readonly kind: LurcAssessmentErrorKind,
    message: string
  ) {
    super(message);
    this.name = "LurcAssessmentError";
  }
}

export function validateLurcQuestionSet(
  questions: readonly LurcAssessmentQuestion[]
): asserts questions is readonly ValidLurcAssessmentQuestion[] {
  validateLurcQuestions(questions);
  if (questions.length !== LURC_QUESTION_COUNT) {
    throw new LurcAssessmentError("configuration", "The Loading, Unloading & Restraint Compliance Assessment requires exactly 10 approved questions.");
  }
}

export function validateLurcQuestions(
  questions: readonly LurcAssessmentQuestion[]
): asserts questions is readonly ValidLurcAssessmentQuestion[] {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.id || ids.has(question.id)) {
      throw new LurcAssessmentError("configuration", "The loading, unloading and restraint assessment contains invalid question IDs.");
    }
    ids.add(question.id);

    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 6 ||
      question.options.some((option) => typeof option !== "string" || !option.trim())
    ) {
      throw new LurcAssessmentError("configuration", "A loading, unloading and restraint assessment question has invalid answer options.");
    }
    if (
      !Number.isInteger(question.correct_answer) ||
      question.correct_answer < 0 ||
      question.correct_answer >= question.options.length
    ) {
      throw new LurcAssessmentError("configuration", "A loading, unloading and restraint assessment question has an invalid answer key.");
    }
  }
}

export function gradeLurcAssessment(
  questions: readonly LurcAssessmentQuestion[],
  answers: Record<string, number>
) {
  validateLurcQuestionSet(questions);

  const questionIds = new Set(questions.map((question) => question.id));
  const answerIds = Object.keys(answers);
  if (answerIds.length !== questionIds.size || answerIds.some((id) => !questionIds.has(id))) {
    throw new LurcAssessmentError("answers", "Answer every assessment question before submitting.");
  }

  let correctCount = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
      throw new LurcAssessmentError("answers", "One or more answers are invalid. Review the assessment and try again.");
    }
    if (answer === question.correct_answer) correctCount += 1;
  }

  return {
    correct_count: correctCount,
    score: Math.round((correctCount / LURC_QUESTION_COUNT) * 100),
    total_questions: LURC_QUESTION_COUNT,
    passed: correctCount === LURC_QUESTION_COUNT
  };
}

export function buildLurcAnswerReview(
  questions: readonly LurcAssessmentQuestion[],
  answers: Record<string, number>
): LurcAnswerReview[] {
  validateLurcQuestions(questions);
  return questions.map((question) => {
    const options = question.options as string[];
    const selectedIndex = answers[question.id];
    return {
      question_id: question.id,
      question: question.question,
      selected_answer: options[selectedIndex] ?? "No answer",
      correct_answer: options[question.correct_answer],
      is_correct: selectedIndex === question.correct_answer
    };
  });
}

export function addLurcAttemptNumbers<T extends LurcAttemptRecord>(
  newestFirst: readonly T[]
): Array<T & { attempt_number: number }> {
  const attemptNumbers = new Map<string, number>();
  const attemptsByUser = new Map<string, number>();
  for (const row of [...newestFirst].reverse()) {
    const userId = String(row.user_id);
    const attemptNumber = (attemptsByUser.get(userId) ?? 0) + 1;
    attemptsByUser.set(userId, attemptNumber);
    attemptNumbers.set(String(row.id), attemptNumber);
  }

  return newestFirst.map((row) => ({
    ...row,
    attempt_number: attemptNumbers.get(String(row.id)) ?? 1
  }));
}