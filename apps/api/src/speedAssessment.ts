export const SPEED_AWARENESS_QUESTION_COUNT = 10;

export interface SpeedAssessmentQuestion {
  id: string;
  question: string;
  options: unknown;
  correct_answer: number;
}

interface ValidSpeedAssessmentQuestion extends SpeedAssessmentQuestion {
  options: string[];
}

export type SpeedAssessmentErrorKind = "configuration" | "answers";

export interface SpeedAttemptRecord {
  id: string;
  user_id: string;
}

export interface SpeedAnswerReview {
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
}

export class SpeedAssessmentError extends Error {
  constructor(
    readonly kind: SpeedAssessmentErrorKind,
    message: string
  ) {
    super(message);
    this.name = "SpeedAssessmentError";
  }
}

export function validateSpeedQuestionSet(
  questions: readonly SpeedAssessmentQuestion[]
): asserts questions is readonly ValidSpeedAssessmentQuestion[] {
  validateSpeedQuestions(questions);
  if (questions.length !== SPEED_AWARENESS_QUESTION_COUNT) {
    throw new SpeedAssessmentError("configuration", "The Speed Awareness Assessment requires exactly 10 approved questions.");
  }
}

export function validateSpeedQuestions(
  questions: readonly SpeedAssessmentQuestion[]
): asserts questions is readonly ValidSpeedAssessmentQuestion[] {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.id || ids.has(question.id)) {
      throw new SpeedAssessmentError("configuration", "The speed assessment contains invalid question IDs.");
    }
    ids.add(question.id);

    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 6 ||
      question.options.some((option) => typeof option !== "string" || !option.trim())
    ) {
      throw new SpeedAssessmentError("configuration", "A speed assessment question has invalid answer options.");
    }
    if (
      !Number.isInteger(question.correct_answer) ||
      question.correct_answer < 0 ||
      question.correct_answer >= question.options.length
    ) {
      throw new SpeedAssessmentError("configuration", "A speed assessment question has an invalid answer key.");
    }
  }
}

export function gradeSpeedAssessment(
  questions: readonly SpeedAssessmentQuestion[],
  answers: Record<string, number>
) {
  validateSpeedQuestionSet(questions);

  const questionIds = new Set(questions.map((question) => question.id));
  const answerIds = Object.keys(answers);
  if (answerIds.length !== questionIds.size || answerIds.some((id) => !questionIds.has(id))) {
    throw new SpeedAssessmentError("answers", "Answer every assessment question before submitting.");
  }

  let correctCount = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
      throw new SpeedAssessmentError("answers", "One or more answers are invalid. Review the assessment and try again.");
    }
    if (answer === question.correct_answer) correctCount += 1;
  }

  return {
    correct_count: correctCount,
    score: Math.round((correctCount / SPEED_AWARENESS_QUESTION_COUNT) * 100),
    total_questions: SPEED_AWARENESS_QUESTION_COUNT,
    passed: correctCount === SPEED_AWARENESS_QUESTION_COUNT
  };
}

export function buildSpeedAnswerReview(
  questions: readonly SpeedAssessmentQuestion[],
  answers: Record<string, number>
): SpeedAnswerReview[] {
  validateSpeedQuestions(questions);
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

export function addSpeedAttemptNumbers<T extends SpeedAttemptRecord>(
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