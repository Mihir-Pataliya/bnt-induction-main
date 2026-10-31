-- Seed the approved standalone Distraction Awareness Assessment question set,
-- topping up existing configurations without creating more than 10 questions.
WITH approved_questions (
  id, assessment_id, question, options, correct_answer, explanation, category, sort_order
) AS (
  VALUES
  (
    'da000000-0000-4000-8000-000000000001'::uuid, 'distraction_awareness',
    'Which of the following is a common driver distraction in a heavy vehicle?',
    '["Using a mobile phone while driving", "Checking mirrors regularly", "Planning rest breaks before departure", "Completing pre-start checks"]'::jsonb,
    0, 'Mobile phone use takes eyes, hands and attention away from driving.', 'Distraction Awareness', 1
  ),
  (
    'da000000-0000-4000-8000-000000000002'::uuid, 'distraction_awareness',
    'What should you do with navigation before starting a trip?',
    '["Enter the destination and review the route before moving", "Type the address while driving at low speed", "Hold the phone in your hand for quick changes", "Ask a passenger to change the route while moving"]'::jsonb,
    0, 'Set up navigation while parked so attention stays on the road.', 'Distraction Awareness', 2
  ),
  (
    'da000000-0000-4000-8000-000000000003'::uuid, 'distraction_awareness',
    'If your phone rings while you are driving, what is the safest response?',
    '["Let it ring and respond only after stopping safely", "Answer on speaker while holding the phone", "Read the message at the next set of lights", "Pull over abruptly wherever possible"]'::jsonb,
    0, 'Do not interact with a phone while driving; respond only when safely parked.', 'Distraction Awareness', 3
  ),
  (
    'da000000-0000-4000-8000-000000000004'::uuid, 'distraction_awareness',
    'How can eating or drinking while driving affect safety?',
    '["It can divide attention and reduce vehicle control", "It improves alertness on long trips", "It has no effect at low speeds", "It only matters in city traffic"]'::jsonb,
    0, 'Manual and cognitive distraction from eating or drinking can delay reactions.', 'Distraction Awareness', 4
  ),
  (
    'da000000-0000-4000-8000-000000000005'::uuid, 'distraction_awareness',
    'How should passenger conversation be managed while driving?',
    '["Keep it brief and avoid distracting or emotional topics", "Encourage lively discussion to stay awake", "Allow any conversation because passengers are not regulated", "Only restrict conversation for learner drivers"]'::jsonb,
    0, 'Conversation should not divert attention from the driving task.', 'Distraction Awareness', 5
  ),
  (
    'da000000-0000-4000-8000-000000000006'::uuid, 'distraction_awareness',
    'When is the best time to adjust radio, climate or mirror settings?',
    '["When the vehicle is safely stopped or in a low-risk moment", "While reversing into a loading area", "During heavy traffic to save time", "At every traffic light regardless of conditions"]'::jsonb,
    0, 'Adjust controls when they will not interfere with hazard perception.', 'Distraction Awareness', 6
  ),
  (
    'da000000-0000-4000-8000-000000000007'::uuid, 'distraction_awareness',
    'What should you do if distraction causes you to miss or nearly miss a hazard?',
    '["Stop safely, report the incident and refocus before continuing", "Continue if no collision occurred", "Speed up to make up lost time", "Blame road conditions in your report"]'::jsonb,
    0, 'A near miss is a warning that the driving task was compromised.', 'Distraction Awareness', 7
  ),
  (
    'da000000-0000-4000-8000-000000000008'::uuid, 'distraction_awareness',
    'Under Chain of Responsibility, who should take distraction risks seriously?',
    '["Only the driver", "Only the scheduler", "Everyone whose actions influence transport activities", "Only the vehicle owner"]'::jsonb,
    2, 'CoR duties are shared by all parties who influence transport activities.', 'Distraction Awareness', 8
  ),
  (
    'da000000-0000-4000-8000-000000000009'::uuid, 'distraction_awareness',
    'What is the safest way to handle a message while driving?',
    '["Pull over in a safe, legal place before reading or replying", "Glance at it quickly while maintaining speed", "Ask a passenger to read and reply for you while moving", "Wait until the next rest break if it is not urgent"]'::jsonb,
    0, 'Do not read or reply to messages while the vehicle is moving.', 'Distraction Awareness', 9
  ),
  (
    'da000000-0000-4000-8000-000000000010'::uuid, 'distraction_awareness',
    'Which action best reduces distraction before a trip?',
    '["Complete pre-drive setup and secure loose items before moving", "Leave phone notifications enabled for quick checks", "Place paperwork on the passenger seat for easy access", "Adjust mirrors while entering traffic"]'::jsonb,
    0, 'Preparation before moving keeps attention on driving.', 'Distraction Awareness', 10
  )
),
configured AS (
  SELECT count(*)::integer AS question_count
  FROM public.distraction_awareness_questions
  WHERE assessment_id = 'distraction_awareness'
),
missing_questions AS (
  SELECT approved.*
  FROM approved_questions AS approved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.distraction_awareness_questions AS existing
    WHERE existing.assessment_id = approved.assessment_id
      AND existing.id = approved.id
  )
  ORDER BY approved.sort_order
  LIMIT (SELECT GREATEST(0, 10 - question_count) FROM configured)
)
INSERT INTO public.distraction_awareness_questions (
  id, assessment_id, question, options, correct_answer, explanation, category, sort_order
)
SELECT id, assessment_id, question, options, correct_answer, explanation, category, sort_order
FROM missing_questions
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';