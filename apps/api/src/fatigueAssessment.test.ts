import test from "node:test";
import assert from "node:assert/strict";
import {
  FATIGUE_AWARENESS_QUESTION_COUNT,
  FatigueAssessmentError,
  buildFatigueAnswerReview,
  addFatigueAttemptNumbers,
  gradeFatigueAssessment,
  validateFatigueQuestions,
  validateFatigueQuestionSet
} from "./fatigueAssessment.js";

const questions = Array.from({ length: FATIGUE_AWARENESS_QUESTION_COUNT }, (_, index) => ({
  id: `question-${index + 1}`,
  question: `Fatigue question ${index + 1}`,
  options: ["First", "Second", "Third", "Fourth"],
  correct_answer: index % 4
}));

test("grades only a complete 10-question assessment and requires every answer correct to pass", () => {
  const allCorrect = Object.fromEntries(questions.map((question) => [question.id, question.correct_answer]));
  assert.deepEqual(gradeFatigueAssessment(questions, allCorrect), {
    correct_count: 10,
    score: 100,
    total_questions: 10,
    passed: true
  });

  const oneIncorrect = { ...allCorrect, [questions[0].id]: 1 };
  assert.deepEqual(gradeFatigueAssessment(questions, oneIncorrect), {
    correct_count: 9,
    score: 90,
    total_questions: 10,
    passed: false
  });
});

test("rejects incomplete, extra, and out-of-range answers", () => {
  const allCorrect = Object.fromEntries(questions.map((question) => [question.id, question.correct_answer]));
  const missingAnswer = { ...allCorrect };
  delete missingAnswer[questions[0].id];

  assert.throws(() => gradeFatigueAssessment(questions, missingAnswer), FatigueAssessmentError);
  assert.throws(() => gradeFatigueAssessment(questions, { ...allCorrect, unexpected: 0 }), FatigueAssessmentError);
  assert.throws(() => gradeFatigueAssessment(questions, { ...allCorrect, [questions[0].id]: 4 }), FatigueAssessmentError);
});

test("rejects an incomplete or invalid configured question set", () => {
  assert.doesNotThrow(() => validateFatigueQuestions(questions.slice(0, 1)));
  assert.throws(() => validateFatigueQuestionSet(questions.slice(0, 9)), FatigueAssessmentError);
  assert.throws(() => validateFatigueQuestions(questions.map((question, index) => index === 0 ? { ...question, options: [] } : question)), FatigueAssessmentError);
  assert.throws(
    () => validateFatigueQuestionSet(questions.map((question, index) => index === 0 ? { ...question, correct_answer: 4 } : question)),
    FatigueAssessmentError
  );
});

test("numbers saved attempts chronologically for each driver", () => {
  const attempts = addFatigueAttemptNumbers([
    { id: "driver-b-latest", user_id: "driver-b" },
    { id: "driver-a-latest", user_id: "driver-a" },
    { id: "driver-b-first", user_id: "driver-b" },
    { id: "driver-a-first", user_id: "driver-a" }
  ]);
  assert.deepEqual(attempts.map(({ id, attempt_number }) => [id, attempt_number]), [
    ["driver-b-latest", 2],
    ["driver-a-latest", 2],
    ["driver-b-first", 1],
    ["driver-a-first", 1]
  ]);
});

test("builds a review snapshot of each driver's selected and correct answers", () => {
  const answers = Object.fromEntries(questions.map((question) => [question.id, question.correct_answer]));
  answers[questions[0].id] = 1;
  const review = buildFatigueAnswerReview(questions, answers);
  assert.equal(review.length, 10);
  assert.deepEqual(review[0], {
    question_id: "question-1",
    question: "Fatigue question 1",
    selected_answer: "Second",
    correct_answer: "First",
    is_correct: false
  });
  assert.equal(review[1].is_correct, true);
});
