-- Publish the four core workplace policies through the existing versioned policy
-- system and add mandatory learning sections/questions through existing course
-- tables. Stable IDs make this safe to re-run without duplicating records.

INSERT INTO public.policies (
  id, title, name, version, version_label, content, audience, target_role,
  policy_group_id, status, is_published, published_at
)
VALUES
(
  'a0300000-0000-4000-8000-000000000001',
  'Incident, Injury and Hazard Reporting Procedure',
  'Incident, Injury and Hazard Reporting Procedure', '1.0', '1.0',
  $incident$
BNT LOGISTICS — INCIDENT, INJURY AND HAZARD REPORTING PROCEDURE

PURPOSE AND SCOPE
Everyone performing work for BNT Logistics, including employees, labour-hire workers, contractors and their workers, must promptly report work-related incidents, injuries, illnesses, near misses, hazards, vehicle incidents and damaged goods. Report events at a BNT depot, customer site, on the road, or during loading and unloading.

IMMEDIATE RESPONSE
1. If a person is seriously injured, in immediate danger, or needs urgent assistance, call 000 first. Give first aid only if trained and safe to do so.
2. Stop work and prevent further exposure where it is safe. Do not put yourself or another person at risk. Isolate an unsafe vehicle or equipment and do not use it until it has been checked and cleared.
3. At a customer or worksite, follow that site's emergency and incident notification instructions as well as this procedure.

REPORTING STEPS
1. Tell your supervisor or site contact as soon as possible. If they are unavailable or involved in the event, contact another BNT manager or administrator. Contractors should also notify their employer or company supervisor.
2. Drivers should submit a report using Driver Portal → Incidents. Include the time, location, people or property affected, what happened, injury or damage details, witnesses, immediate actions and available supporting evidence. Report a near miss even when no one was hurt and nothing was damaged.
3. Make the report promptly and, for hazards and near misses, within one hour where practicable. Do not delay emergency assistance or immediate notification in order to complete the online form.
4. Preserve relevant records, photographs and damaged goods where safe and practicable. Do not alter evidence or speculate about fault. Cooperate with follow-up and risk-control actions.

REPORTABLE EVENTS
Report accidents, injuries and illness; near misses; unsafe conditions and hazards; damaged freight or goods; vehicle collisions, defects or other vehicle incidents; spills; and any event that could affect worker, customer or public safety.

REVIEW AND SUPPORT
BNT managers must ensure reports are reviewed, urgent risks are controlled, appropriate people are notified and corrective actions are recorded. Do not retaliate against anyone who raises a genuine safety concern. For an immediate threat to life or safety call 000. The online incident form is available to drivers in the Driver Portal; other workers should notify their supervisor, site contact or a BNT manager directly.
$incident$,
  'all', 'all', 'a0300000-0000-4000-8000-000000000001', 'published', true, now()
),
(
  'a0300000-0000-4000-8000-000000000002',
  'Privacy and Confidentiality Policy and Undertaking',
  'Privacy and Confidentiality Policy and Undertaking', '1.0', '1.0',
  $privacy$
BNT LOGISTICS — PRIVACY AND CONFIDENTIALITY POLICY AND UNDERTAKING

PURPOSE AND SCOPE
Employees, contractors and contractor workers must protect personal, commercial, customer, supplier and workforce information they access through BNT work. This includes identity and contact details, licences and medical information, payroll and employment records, customer and freight records, access credentials, incident information and business-sensitive material.

REQUIRED HANDLING
• Access and use information only for an authorised work purpose and only to the extent needed for that purpose.
• Share information only with an authorised recipient who needs it for their work. Check recipients before sending and use approved systems and secure storage.
• Keep paper records and devices secure. Protect passwords and accounts; do not share credentials or leave sensitive information visible in vehicles, depots or public places.
• Do not post, copy, discuss or disclose confidential information in public, personal messaging, social media or unauthorised services. Do not use it for personal gain or to disadvantage another person or business.
• Return, securely delete or hand over information and access when requested or when your work ends, subject to any lawful record-retention requirement.

INCIDENTS AND EXCEPTIONS
Promptly tell your supervisor or a BNT manager/administrator if information is lost, sent to the wrong person, accessed without authority, or otherwise exposed. Do not conceal or independently investigate a suspected breach. This policy does not prevent a lawful disclosure, a report to a regulator or emergency service, or a protected report of suspected wrongdoing.

CONFIDENTIALITY UNDERTAKING
By signing this policy, I acknowledge that I have read and understood these requirements. I undertake to protect confidential information, use it only for authorised work, disclose it only to authorised recipients, promptly report suspected loss or unauthorised access, and continue to protect information after my employment or engagement ends. I understand that this undertaking does not restrict a disclosure required or protected by law.

REPORTING
Raise a privacy or confidentiality concern promptly with your supervisor. If the concern involves that person, or you cannot safely raise it with them, contact another BNT manager or administrator. Contractors should also notify their employer or company supervisor. Use emergency services for an immediate threat to a person's safety.
$privacy$,
  'all', 'all', 'a0300000-0000-4000-8000-000000000002', 'published', true, now()
),
(
  'a0300000-0000-4000-8000-000000000003',
  'Code of Conduct', 'Code of Conduct', '1.0', '1.0',
  $conduct$
BNT LOGISTICS — CODE OF CONDUCT

PURPOSE AND SCOPE
This code applies to employees, contractors and contractor workers while working for BNT Logistics, representing the business, using its systems or property, or interacting with colleagues, customers, suppliers and the public.

EXPECTED CONDUCT
• Act honestly, lawfully, respectfully and fairly. Treat people with dignity and do not discriminate, bully, harass, threaten or retaliate.
• Put safety first. Follow safe work instructions, site rules, fatigue requirements, vehicle and load procedures, and use required PPE. Stop and raise work that appears unsafe or unlawful.
• Keep licences, training, timesheets, delivery records, vehicle checks, expenses and incident reports accurate. Never falsify, conceal or improperly alter a record.
• Protect customer goods, vehicles, equipment, money, information and access credentials. Use them only for authorised work and report loss or damage promptly.
• Disclose actual or potential conflicts of interest and do not offer, request or accept improper payments or benefits.
• Attend work fit for duty and do not work while impaired by alcohol, drugs or another condition that makes the task unsafe.
• Cooperate honestly with reasonable audits, safety reviews and investigations. Maintain confidentiality and do not interfere with a report or witness.

RAISING A CONCERN
Report suspected misconduct, unsafe or unlawful directions, conflicts of interest, fraud, or breaches of this code to your supervisor or a BNT manager. If the concern involves that person, contact another manager or administrator. Contractors should also notify their employer or company supervisor. Safety incidents should also be reported through Driver Portal → Incidents where available. Reports will be handled discreetly, shared only as needed for a fair response, and retaliation for a genuine report is prohibited.

ACKNOWLEDGEMENT
By signing, I confirm that I have read this code, understand the conduct expected of me, and will raise concerns in good faith.
$conduct$,
  'all', 'all', 'a0300000-0000-4000-8000-000000000003', 'published', true, now()
),
(
  'a0300000-0000-4000-8000-000000000004',
  'Workplace Behaviour, Bullying and Harassment Policy',
  'Workplace Behaviour, Bullying and Harassment Policy', '1.0', '1.0',
  $behaviour$
BNT LOGISTICS — WORKPLACE BEHAVIOUR, BULLYING AND HARASSMENT POLICY

COMMITMENT AND SCOPE
BNT Logistics expects a safe, respectful and inclusive workplace. This policy applies to employees, contractors and contractor workers at depots, customer sites, in vehicles, during work travel, and in work-related calls, messages and online spaces.

PROHIBITED BEHAVIOUR
Bullying, harassment, sexual harassment, discrimination, vilification, intimidation, threats, victimisation and retaliation are not acceptable. Bullying includes repeated unreasonable behaviour that creates a risk to health and safety. A single serious incident, sexual harassment, discrimination or threat may be unacceptable even if it is not repeated. Reasonable, respectful management action carried out lawfully is not bullying.

REPORTING OPTIONS
You may raise a concern verbally or in writing with your supervisor or manager. If that person is involved, unavailable, or you do not feel safe approaching them, contact another BNT manager or administrator. Contractors may also contact their employer or company supervisor and should notify their BNT contract/site contact. If there is an immediate threat or assault, move to safety and call 000. Where a concern also involves a safety incident or injury, use Driver Portal → Incidents where available; that form is not a substitute for raising a bullying or harassment complaint with a manager.

HOW REPORTS ARE HANDLED
Share what happened, when and where, who was involved, any witnesses, and what support or immediate safety measures you need. BNT will respond promptly, assess immediate risks, explain next steps, and arrange a fair and impartial review where appropriate. Information will be handled discreetly and disclosed only to people who need it to provide support, assess the report or take action. Absolute confidentiality cannot be promised where a fair investigation or legal obligation requires disclosure. People involved will be treated fairly and given an opportunity to respond.

SUPPORT AND PROTECTION
Retaliation against a person who raises a concern in good faith, supports another person or participates honestly in a review is prohibited. Report further retaliation through the same alternative reporting channels. BNT may take reasonable interim steps to protect people's safety and wellbeing while a concern is considered. Support is available through a manager or administrator; urgent medical or safety needs should be directed to emergency services.

ACKNOWLEDGEMENT
By signing, I confirm that I have read and understood this policy and know the reporting options available to me.
$behaviour$,
  'all', 'all', 'a0300000-0000-4000-8000-000000000004', 'published', true, now()
)
ON CONFLICT (id) DO NOTHING;

-- Establish version 1.0 in the authoritative version table. The normal driver
-- acknowledgement flow records each worker's signature against this version.
INSERT INTO public.policy_versions (policy_id, version_label, content, published_at)
SELECT p.id, '1.0', p.content, p.published_at
FROM public.policies p
WHERE p.id IN (
  'a0300000-0000-4000-8000-000000000001',
  'a0300000-0000-4000-8000-000000000002',
  'a0300000-0000-4000-8000-000000000003',
  'a0300000-0000-4000-8000-000000000004'
)
AND NOT EXISTS (
  SELECT 1 FROM public.policy_versions pv
  WHERE pv.policy_id = p.id AND pv.version_label = '1.0'
);

-- These shared learning_sections are required by the existing Step 3/final
-- approval checks for both employee and contractor drivers.
WITH base AS (
  SELECT coalesce(max(sort_order), 0) AS max_order FROM public.learning_sections
), modules AS (
  SELECT * FROM (VALUES
    ('a0300000-0000-4000-8000-000000000011'::uuid, 'Privacy and Confidentiality', 1,
      'Apply the privacy and confidentiality policy when handling driver, customer, freight and business information.',
      ARRAY['Access information only for authorised work and share it only with people who need it.', 'Secure paper records, devices and login credentials; check recipients before sending information.', 'Promptly report lost, misdirected or exposed information to a supervisor or BNT manager.', 'The confidentiality undertaking allows disclosures required or protected by law.'],
      'A delivery document is sent to the wrong recipient. Stop further sharing, notify a supervisor or BNT manager promptly, and preserve the details for follow-up.'),
    ('a0300000-0000-4000-8000-000000000012'::uuid, 'Code of Conduct', 2,
      'Understand the conduct expected when working for BNT Logistics or representing the business.',
      ARRAY['Act honestly, lawfully and respectfully; do not bully, harass, discriminate or retaliate.', 'Follow safety rules and raise unsafe or unlawful directions.', 'Keep work, delivery, vehicle and incident records accurate.', 'Protect customer property and disclose conflicts of interest.'],
      'A colleague asks you to falsify a delivery or vehicle record. Refuse and raise the request with your supervisor or another BNT manager.'),
    ('a0300000-0000-4000-8000-000000000013'::uuid, 'Respectful Workplace and Anti-Bullying', 3,
      'Recognise unacceptable workplace behaviour and learn safe reporting options.',
      ARRAY['Bullying, harassment, sexual harassment, discrimination, threats and retaliation are prohibited.', 'You may report to your supervisor or manager, or another BNT manager/administrator if that person is involved or unavailable.', 'Contractors may also notify their employer and BNT contract/site contact.', 'Reports are handled discreetly and fairly; absolute confidentiality cannot be promised where review or law requires disclosure.'],
      'Your supervisor is the person whose conduct concerns you. Raise the concern with another BNT manager or administrator; do not use the safety incident form as a substitute complaint channel.'),
    ('a0300000-0000-4000-8000-000000000014'::uuid, 'Incident, Injury and Hazard Reporting', 4,
      'Respond to and report accidents, injuries, near misses, hazards, damaged goods and vehicle incidents.',
      ARRAY['Call 000 first for immediate danger or urgent medical assistance.', 'Make the area safe only if it is safe to do so, and follow site emergency instructions.', 'Tell a supervisor or site contact promptly; report hazards and near misses within one hour where practicable.', 'Drivers submit the Driver Portal incident form with time, location, people/property affected, actions and evidence.'],
      'A near miss occurs during unloading and nobody is hurt. Make the area safe, notify the site contact promptly, and submit a Driver Portal report within one hour where practicable.')
  ) AS v(id, title, order_offset, intro, bullets, scenario)
)
INSERT INTO public.learning_sections (
  id, title, format, summary, video_url, video_duration_seconds, require_full_watch, sort_order
)
SELECT m.id, m.title, 'Required Policy Training',
  jsonb_build_object('intro', m.intro, 'bullets', m.bullets, 'scenario', m.scenario)::text,
  NULL, 0, false, base.max_order + m.order_offset
FROM modules m CROSS JOIN base
ON CONFLICT (id) DO NOTHING;

-- Required induction quiz knowledge checks, delivered by the existing quiz
-- attempt/pass gate and editable in the existing Admin CMS.
INSERT INTO public.quiz_questions (
  id, question, options, correct_answer, explanation, sort_order, category, is_critical
)
VALUES
(
  'a0300000-0000-4000-8000-000000000021',
  'A driver notices that customer information has been sent to the wrong recipient. What should they do?',
  '["Ignore it if the recipient is known", "Promptly tell a supervisor or BNT manager and preserve the details", "Post a warning publicly", "Delete the evidence and wait"]'::jsonb,
  1, 'Promptly report suspected disclosure through a supervisor or BNT manager so it can be contained and reviewed.', 9001, 'Privacy and Confidentiality', false
),
(
  'a0300000-0000-4000-8000-000000000022',
  'A colleague asks you to falsify a delivery or vehicle record. What is the appropriate response?',
  '["Make the change to help the team", "Refuse and raise the request with a supervisor or another BNT manager", "Delete the original record", "Ask a customer to approve it"]'::jsonb,
  1, 'Records must be accurate. Refuse falsification and raise the concern through management.', 9002, 'Code of Conduct', false
),
(
  'a0300000-0000-4000-8000-000000000023',
  'You want to raise a bullying concern about your direct supervisor. Which option is appropriate?',
  '["Do not report it", "Raise it with another BNT manager or administrator; contractors may also notify their employer", "Use only the safety incident form", "Confront the person alone regardless of safety"]'::jsonb,
  1, 'An alternative manager or administrator is an appropriate route when the supervisor is involved; contractors may also contact their employer.', 9003, 'Workplace Behaviour', false
),
(
  'a0300000-0000-4000-8000-000000000024',
  'A near miss occurs during unloading, with no injury. What should you do?',
  '["Report it promptly to the site contact and submit a Driver Portal incident report", "Report only if someone is injured", "Wait until the next shift", "Do not report if no goods were damaged"]'::jsonb,
  0, 'Near misses must be reported so risks can be controlled even when nobody is injured and nothing is damaged.', 9004, 'Incident Reporting', false
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
