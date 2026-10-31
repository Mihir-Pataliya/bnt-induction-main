import test from "node:test";
import assert from "node:assert/strict";
import {
  SPEED_AWARENESS_QUESTION_COUNT,
  SpeedAssessmentError,
  buildSpeedAnswerReview,
  addSpeedAttemptNumbers,
  gradeSpeedAssessment,
  validateSpeedQuestions,
  validateSpeedQuestionSet
} from "./speedAssessment.js";

const questions = Array.from({ length: SPEED_AWARENESS_QUESTION_COUNT }, (_, index) => ({
  id: `question-${index + 1}`,
  question: `Speed question ${index + 1}`,
  options: ["First", "Second", "Third", "Fourth"],
  correct_answer: index % 4
}));

test("grades only a complete 10-question assessment and requires every answer correct to pass", () => {
  const allCorrect = Object.fromEntries(questions.map((question) => [question.id, question.correct_answer]));
  assert.deepEqual(gradeSpeedAssessment(questions, allCorrect), {
    correct_count: 10,
    score: 100,
    total_questions: 10,
    passed: true
  });

  const oneIncorrect = { ...allCorrect, [questions[0].id]: 1 };
  assert.deepEqual(gradeSpeedAssessment(questions, oneIncorrect), {
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

  assert.throws(() => gradeSpeedAssessment(questions, missingAnswer), SpeedAssessmentError);
  assert.throws(() => gradeSpeedAssessment(questions, { ...allCorrect, unexpected: 0 }), SpeedAssessmentError);
  assert.throws(() => gradeSpeedAssessment(questions, { ...allCorrect, [questions[0].id]: 4 }), SpeedAssessmentError);
});

test("rejects an incomplete or invalid configured question set", () => {
  assert.doesNotThrow(() => validateSpeedQuestions(questions.slice(0, 1)));
  assert.throws(() => validateSpeedQuestionSet(questions.slice(0, 9)), SpeedAssessmentError);
  assert.throws(() => validateSpeedQuestions(questions.map((question, index) => index === 0 ? { ...question, options: [] } : question)), SpeedAssessmentError);
  assert.throws(
    () => validateSpeedQuestionSet(questions.map((question, index) => index === 0 ? { ...question, correct_answer: 4 } : question)),
    SpeedAssessmentError
  );
});

test("numbers saved attempts chronologically for each driver", () => {
  const attempts = addSpeedAttemptNumbers([
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
  const review = buildSpeedAnswerReview(questions, answers);
  assert.equal(review.length, 10);
  assert.deepEqual(review[0], {
    question_id: "question-1",
    question: "Speed question 1",
    selected_answer: "Second",
    correct_answer: "First",
    is_correct: false
  });
  assert.equal(review[1].is_correct, true);
});
