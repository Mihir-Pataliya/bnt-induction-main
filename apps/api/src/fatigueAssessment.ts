export const FATIGUE_AWARENESS_QUESTION_COUNT = 10;

export interface FatigueAssessmentQuestion {
  id: string;
  question: string;
  options: unknown;
  correct_answer: number;
}

interface ValidFatigueAssessmentQuestion extends FatigueAssessmentQuestion {
  options: string[];
}

export type FatigueAssessmentErrorKind = "configuration" | "answers";

export interface FatigueAttemptRecord {
  id: string;
  user_id: string;
}

export interface FatigueAnswerReview {
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
}

export class FatigueAssessmentError extends Error {
  constructor(
    readonly kind: FatigueAssessmentErrorKind,
    message: string
  ) {
    super(message);
    this.name = "FatigueAssessmentError";
  }
}

export function validateFatigueQuestionSet(
  questions: readonly FatigueAssessmentQuestion[]
): asserts questions is readonly ValidFatigueAssessmentQuestion[] {
  validateFatigueQuestions(questions);
  if (questions.length !== FATIGUE_AWARENESS_QUESTION_COUNT) {
    throw new FatigueAssessmentError("configuration", "The Fatigue Awareness Assessment requires exactly 10 approved questions.");
  }
}

export function validateFatigueQuestions(
  questions: readonly FatigueAssessmentQuestion[]
): asserts questions is readonly ValidFatigueAssessmentQuestion[] {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.id || ids.has(question.id)) {
      throw new FatigueAssessmentError("configuration", "The fatigue assessment contains invalid question IDs.");
    }
    ids.add(question.id);

    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 6 ||
      question.options.some((option) => typeof option !== "string" || !option.trim())
    ) {
      throw new FatigueAssessmentError("configuration", "A fatigue assessment question has invalid answer options.");
    }
    if (
      !Number.isInteger(question.correct_answer) ||
      question.correct_answer < 0 ||
      question.correct_answer >= question.options.length
    ) {
      throw new FatigueAssessmentError("configuration", "A fatigue assessment question has an invalid answer key.");
    }
  }
}

export function gradeFatigueAssessment(
  questions: readonly FatigueAssessmentQuestion[],
  answers: Record<string, number>
) {
  validateFatigueQuestionSet(questions);

  const questionIds = new Set(questions.map((question) => question.id));
  const answerIds = Object.keys(answers);
  if (answerIds.length !== questionIds.size || answerIds.some((id) => !questionIds.has(id))) {
    throw new FatigueAssessmentError("answers", "Answer every assessment question before submitting.");
  }

  let correctCount = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
      throw new FatigueAssessmentError("answers", "One or more answers are invalid. Review the assessment and try again.");
    }
    if (answer === question.correct_answer) correctCount += 1;
  }

  return {
    correct_count: correctCount,
    score: Math.round((correctCount / FATIGUE_AWARENESS_QUESTION_COUNT) * 100),
    total_questions: FATIGUE_AWARENESS_QUESTION_COUNT,
    passed: correctCount === FATIGUE_AWARENESS_QUESTION_COUNT
  };
}

export function buildFatigueAnswerReview(
  questions: readonly FatigueAssessmentQuestion[],
  answers: Record<string, number>
): FatigueAnswerReview[] {
  validateFatigueQuestions(questions);
  return questions.map((question) => {
    const options = question.options;
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

export function addFatigueAttemptNumbers<T extends FatigueAttemptRecord>(
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
