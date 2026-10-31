-- Seed the approved standalone Fatigue Awareness Assessment question set,
-- topping up existing configurations without creating more than 10 questions.
WITH approved_questions (
  id, assessment_id, question, options, correct_answer, explanation, category, sort_order
) AS (
  VALUES
  (
    'fa000000-0000-4000-8000-000000000001'::uuid, 'fatigue_awareness',
    'Which can be an early sign that you are becoming fatigued while driving?',
    '["Yawning repeatedly or struggling to keep your eyes open", "Feeling unusually energetic", "Remembering every detail of the trip", "Driving more smoothly than usual"]'::jsonb,
    0, 'Recognising fatigue early gives you time to stop safely before your driving is affected.', 'Fatigue Awareness', 1
  ),
  (
    'fa000000-0000-4000-8000-000000000002'::uuid, 'fatigue_awareness',
    'What should you do if you feel too tired to continue driving safely?',
    '["Keep driving and open a window", "Stop at a safe place and notify your supervisor", "Drive faster to finish sooner", "Use your phone to stay alert"]'::jsonb,
    1, 'Stop in a safe location and follow your organisation''s fatigue reporting and rest procedures.', 'Fatigue Awareness', 2
  ),
  (
    'fa000000-0000-4000-8000-000000000003'::uuid, 'fatigue_awareness',
    'Which is the safest way to manage fatigue on a planned trip?',
    '["Plan adequate sleep and breaks before departure", "Rely on caffeine instead of sleep", "Wait until you are nodding off before stopping", "Skip breaks to stay on schedule"]'::jsonb,
    0, 'Adequate sleep and planned rest breaks are essential; stimulants do not replace sleep.', 'Fatigue Awareness', 3
  ),
  (
    'fa000000-0000-4000-8000-000000000004'::uuid, 'fatigue_awareness',
    'How can insufficient sleep affect a driver?',
    '["It can slow reaction time and reduce attention", "It improves concentration after a few hours", "It only affects drivers on unfamiliar roads", "It has no effect if the driver has eaten"]'::jsonb,
    0, 'Sleep loss can impair alertness, judgement and reaction time.', 'Fatigue Awareness', 4
  ),
  (
    'fa000000-0000-4000-8000-000000000005'::uuid, 'fatigue_awareness',
    'Can coffee or energy drinks replace adequate sleep?',
    '["Yes, if consumed before every trip", "Yes, but only for short trips", "No, they may temporarily mask tiredness but do not replace sleep", "No, because drivers must never drink coffee"]'::jsonb,
    2, 'Caffeine may briefly increase alertness, but it does not remove the effects of sleep loss.', 'Fatigue Awareness', 5
  ),
  (
    'fa000000-0000-4000-8000-000000000006'::uuid, 'fatigue_awareness',
    'What should you do if medication may make you drowsy before a shift?',
    '["Ignore the warning if the trip is short", "Check the advice and report the concern before driving", "Take an extra dose to get used to it", "Drive only on familiar roads"]'::jsonb,
    1, 'Check medication warnings and speak with an appropriate health professional and supervisor before driving.', 'Fatigue Awareness', 6
  ),
  (
    'fa000000-0000-4000-8000-000000000007'::uuid, 'fatigue_awareness',
    'When should you tell your supervisor that you are not fit to drive because of fatigue?',
    '["Before starting work or as soon as the concern arises", "Only after completing the delivery", "Only if another driver notices", "At the end of the week"]'::jsonb,
    0, 'Report fitness-for-duty concerns promptly so that safe work arrangements can be made.', 'Fatigue Awareness', 7
  ),
  (
    'fa000000-0000-4000-8000-000000000008'::uuid, 'fatigue_awareness',
    'What is the safest response if a work schedule cannot be completed without driving while fatigued?',
    '["Continue because the schedule takes priority", "Ask for a safe plan and report the fatigue risk", "Skip required rest to arrive on time", "Ask a passenger to keep you awake"]'::jsonb,
    1, 'Safety comes before a schedule. Raise the risk and follow the organisation''s escalation process.', 'Fatigue Awareness', 8
  ),
  (
    'fa000000-0000-4000-8000-000000000009'::uuid, 'fatigue_awareness',
    'What should you do after experiencing a microsleep or briefly nodding off?',
    '["Continue if you feel alert again", "Stop safely, report it and do not resume until fit to drive", "Turn up the radio and continue", "Make up time by driving faster"]'::jsonb,
    1, 'A microsleep is a serious warning that driving is unsafe; stop and report it.', 'Fatigue Awareness', 9
  ),
  (
    'fa000000-0000-4000-8000-000000000010'::uuid, 'fatigue_awareness',
    'Under Chain of Responsibility, who should take fatigue risks seriously?',
    '["Only the driver", "Only the scheduler", "Everyone whose actions influence transport activities", "Only the vehicle owner"]'::jsonb,
    2, 'Chain of Responsibility duties are shared by parties who influence transport activities.', 'Fatigue Awareness', 10
  )
),
configured AS (
  SELECT count(*)::integer AS question_count
  FROM public.fatigue_awareness_questions
  WHERE assessment_id = 'fatigue_awareness'
),
missing_questions AS (
  SELECT approved.*
  FROM approved_questions AS approved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.fatigue_awareness_questions AS existing
    WHERE existing.assessment_id = approved.assessment_id
      AND existing.id = approved.id
  )
  ORDER BY approved.sort_order
  LIMIT (SELECT GREATEST(0, 10 - question_count) FROM configured)
)
INSERT INTO public.fatigue_awareness_questions (
  id, assessment_id, question, options, correct_answer, explanation, category, sort_order
)
SELECT id, assessment_id, question, options, correct_answer, explanation, category, sort_order
FROM missing_questions
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
