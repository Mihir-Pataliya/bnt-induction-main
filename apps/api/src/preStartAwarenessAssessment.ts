export const PRE_START_AWARENESS_QUESTION_COUNT = 10;

export interface PreStartAssessmentQuestion {
  id: string;
  question: string;
  options: unknown;
  correct_answer: number;
}

interface ValidPreStartAssessmentQuestion extends PreStartAssessmentQuestion {
  options: string[];
}

export type PreStartAssessmentErrorKind = "configuration" | "answers";

export interface PreStartAttemptRecord {
  id: string;
  user_id: string;
}

export interface PreStartAnswerReview {
  question_id: string;
  question: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
}

export class PreStartAssessmentError extends Error {
  constructor(
    readonly kind: PreStartAssessmentErrorKind,
    message: string
  ) {
    super(message);
    this.name = "PreStartAssessmentError";
  }
}

export function validatePreStartQuestionSet(
  questions: readonly PreStartAssessmentQuestion[]
): asserts questions is readonly ValidPreStartAssessmentQuestion[] {
  validatePreStartQuestions(questions);
  if (questions.length !== PRE_START_AWARENESS_QUESTION_COUNT) {
    throw new PreStartAssessmentError("configuration", "The Pre-Start & Fault Reporting Awareness Assessment requires exactly 10 approved questions.");
  }
}

export function validatePreStartQuestions(
  questions: readonly PreStartAssessmentQuestion[]
): asserts questions is readonly ValidPreStartAssessmentQuestion[] {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.id || ids.has(question.id)) {
      throw new PreStartAssessmentError("configuration", "The pre-start assessment contains invalid question IDs.");
    }
    ids.add(question.id);

    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 6 ||
      question.options.some((option) => typeof option !== "string" || !option.trim())
    ) {
      throw new PreStartAssessmentError("configuration", "A pre-start assessment question has invalid answer options.");
    }
    if (
      !Number.isInteger(question.correct_answer) ||
      question.correct_answer < 0 ||
      question.correct_answer >= question.options.length
    ) {
      throw new PreStartAssessmentError("configuration", "A pre-start assessment question has an invalid answer key.");
    }
  }
}

export function gradePreStartAssessment(
  questions: readonly PreStartAssessmentQuestion[],
  answers: Record<string, number>
) {
  validatePreStartQuestionSet(questions);

  const questionIds = new Set(questions.map((question) => question.id));
  const answerIds = Object.keys(answers);
  if (answerIds.length !== questionIds.size || answerIds.some((id) => !questionIds.has(id))) {
    throw new PreStartAssessmentError("answers", "Answer every assessment question before submitting.");
  }

  let correctCount = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    if (!Number.isInteger(answer) || answer < 0 || answer >= question.options.length) {
      throw new PreStartAssessmentError("answers", "One or more answers are invalid. Review the assessment and try again.");
    }
    if (answer === question.correct_answer) correctCount += 1;
  }

  return {
    correct_count: correctCount,
    score: Math.round((correctCount / PRE_START_AWARENESS_QUESTION_COUNT) * 100),
    total_questions: PRE_START_AWARENESS_QUESTION_COUNT,
    passed: correctCount === PRE_START_AWARENESS_QUESTION_COUNT
  };
}

export function buildPreStartAnswerReview(
  questions: readonly PreStartAssessmentQuestion[],
  answers: Record<string, number>
): PreStartAnswerReview[] {
  validatePreStartQuestions(questions);
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

export function addPreStartAttemptNumbers<T extends PreStartAttemptRecord>(
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