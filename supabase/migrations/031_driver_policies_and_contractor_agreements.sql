-- Add missing driver policy content and contractor agreement document tracking
-- using the existing policy/version/signature, course, and company tables.
-- This migration is additive and does not delete or replace existing records.

ALTER TABLE public.contractor_companies
  ADD COLUMN IF NOT EXISTS agreement_file_path text,
  ADD COLUMN IF NOT EXISTS agreement_expiry date,
  ADD COLUMN IF NOT EXISTS agreement_status text NOT NULL DEFAULT 'missing'
    CHECK (agreement_status IN ('missing', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS agreement_rejection_reason text;

ALTER TABLE public.policy_signatures
  ADD COLUMN IF NOT EXISTS contractor_company_id uuid REFERENCES public.contractor_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contractor_agreement_file_path text;

WITH policy_seed AS (
  SELECT * FROM (VALUES
    ('a0310000-0000-4000-8000-000000000001'::uuid, 'Emergency and Evacuation Procedure', $emergency$
BNT LOGISTICS — EMERGENCY AND EVACUATION PROCEDURE

PURPOSE
This procedure applies to employees, contractors and contractor workers at BNT workplaces and customer sites. Follow the local site's emergency plan whenever it gives more specific instructions.

IF AN EMERGENCY OCCURS
1. Stop work. Raise the alarm using the site's alarm, emergency number or direct warning. Call 000 for fire, serious injury, immediate danger or urgent emergency assistance.
2. Do not put yourself or others at risk. Do not fight a fire or attempt a rescue unless trained, equipped and safe to do so.
3. Follow the site warden's instructions. Leave by the nearest safe marked exit; do not use lifts. Keep clear of vehicle routes and hazardous areas.
4. Go directly to the assembly point shown on the current site evacuation map. Do not leave the assembly point or re-enter until the warden or emergency services say it is safe. Report missing or injured people to the warden.
5. Drivers at a customer site must follow that site's emergency plan and notify their supervisor or site contact as soon as it is safe.

SITE-SPECIFIC INDUCTION
Before starting work at each depot or customer site, review that site's current evacuation map and emergency contacts with the site supervisor/warden. Identify the alarm method, primary and alternate exits, assembly point, first-aid and fire equipment, and any special assistance arrangements. Site administrators must attach the current site map and enter site-specific contacts/routes in the existing Site Induction course before assigning it. Never guess an exit route or assembly point.

AFTER THE EVENT
When safe, notify the supervisor/site contact and submit an incident report through Driver Portal → Incidents. Preserve relevant evidence where safe and cooperate with the review.

ACKNOWLEDGEMENT
By electronically signing this version, I confirm that I have read this procedure and will complete the site-specific emergency induction before starting work at each site.
$emergency$),
    ('a0310000-0000-4000-8000-000000000002'::uuid, 'IT and Acceptable Use Policy', $it$
BNT LOGISTICS — IT AND ACCEPTABLE USE POLICY

SCOPE
This policy applies to employees, contractors and contractor workers using BNT accounts, portals, email, devices, networks or information.

ACCEPTABLE USE
Use BNT systems for authorised work and limited incidental personal use only where it is lawful, safe, does not disrupt work and does not create material cost or risk. Follow access permissions and instructions. Do not access another person's account, bypass controls, install unauthorised software, share restricted data, or use systems for unlawful, harassing, discriminatory, fraudulent or offensive activity.

PASSWORDS AND ACCESS
Use a unique strong password and multi-factor authentication where offered. Never share passwords or verification codes. Lock devices when unattended, sign out of shared terminals, and promptly request access changes when your role changes or engagement ends. Use only the permissions granted to you.

DEVICES, EMAIL AND DATA
Protect BNT-issued and authorised devices from loss, damage and unauthorised access. Do not disable security controls or connect unapproved storage. Check recipients and attachments before sending email; treat unexpected links and attachments as suspicious. Store work information only in approved systems and do not forward it to personal accounts or unapproved services.

CYBER INCIDENTS
Promptly report suspected phishing, lost devices, exposed credentials, malware, misdirected email, unauthorised access or data loss to your supervisor or a BNT manager/administrator. If the concern involves that person, use another BNT manager/administrator. Do not hide the incident, delete evidence or attempt unauthorised investigation. For immediate physical danger call 000.

ACKNOWLEDGEMENT
By electronically signing, I agree to use BNT technology and information only as authorised and to promptly report suspected security incidents.
$it$),
    ('a0310000-0000-4000-8000-000000000003'::uuid, 'Drug and Alcohol Policy', $drug$
BNT LOGISTICS — DRUG AND ALCOHOL POLICY

SCOPE AND FITNESS FOR WORK
This policy applies to employees, contractors and contractor workers undertaking work for BNT. Do not start, continue or return to safety-sensitive work while impaired by alcohol, illicit drugs, misused medication or another substance. Never drive, operate machinery, load/unload freight or perform safety-sensitive duties while impaired.

MEDICATION AND CONCERNS
If prescribed or over-the-counter medication may affect alertness, coordination or safe work, seek advice from the prescriber/pharmacist and notify the appropriate supervisor before undertaking affected duties. Share only information necessary to manage fitness for work. Do not pressure another person to work while impaired.

REPORTING AND RESPONSE
Stop work and move to a safe location if you may be unfit for duty. Tell your supervisor promptly; if that person is involved or unavailable, contact another BNT manager/administrator. Contractors must also notify their employer/company supervisor. Report an immediate safety incident through Driver Portal → Incidents. Cooperate with a safe, fair fitness-for-work response. Do not retaliate against good-faith safety reports.

ACKNOWLEDGEMENT
By electronically signing, I confirm that I understand the fitness-for-work requirements and reporting steps.
$drug$),
    ('a0310000-0000-4000-8000-000000000004'::uuid, 'Mobile Phone Use Policy', $mobile$
BNT LOGISTICS — MOBILE PHONE USE POLICY

SCOPE
This policy applies to employees, contractors and contractor workers while driving or working around vehicles and mobile plant.

DRIVING
Do not hold, handle, type on, read or interact with a mobile phone while driving. Do not use a phone in a way that distracts you, obstructs your view or compromises vehicle control. Set navigation and necessary controls before moving, use a lawful secured hands-free setup only when it does not distract, and pull over in a safe, legal place before making or answering a call, reading or sending a message, or changing a route. Never stop in a live traffic lane or unsafe shoulder to use a phone. Follow stricter road, site or customer rules where applicable.

WORK AREAS AND INCIDENTS
Keep clear of moving vehicles and machinery while using a phone. Stop in a safe place before taking photographs or reporting a hazard. In an emergency, call 000 when safe and practicable; do not delay urgent assistance.

ACKNOWLEDGEMENT
By electronically signing, I agree to follow this policy and stop safely before using a phone for non-emergency tasks.
$mobile$),
    ('a0310000-0000-4000-8000-000000000005'::uuid, 'Delivery Procedure', $delivery$
BNT LOGISTICS — DELIVERY PROCEDURE

BEFORE DEPARTURE
Confirm the assigned delivery, route/site requirements, vehicle roadworthiness, load restraint, load security, mass/dimension limits and delivery documents. Do not depart with an unsafe vehicle, insecure load, missing required licence/authority, or an instruction that would require unsafe or unlawful work. Raise unclear, unrealistic or unsafe schedules with the supervisor/dispatcher before departure.

AT PICK-UP AND DELIVERY
Follow site traffic, PPE, pedestrian and loading-zone instructions. Verify freight and counts against the delivery documents; secure the load before moving. At the destination, park only in a safe authorised area, follow receiver instructions, and verify the recipient and delivery location before unloading. Record accurate times, quantities, exceptions, damage and proof of delivery in the approved system. Do not sign for work not completed or alter a record to conceal a discrepancy.

DELAYS, DAMAGE AND INCIDENTS
Notify the supervisor/dispatcher promptly of delays, access problems, load shifts, damaged/missing goods, unsafe conditions or delivery disputes. Do not continue if the vehicle or load is unsafe. For injury or immediate danger call 000 first; then make the area safe if safe to do so and report accidents, near misses, hazards, damaged goods or vehicle incidents through Driver Portal → Incidents.

ACKNOWLEDGEMENT
By electronically signing, I confirm that I will follow the delivery, load-security, site-safety and accurate-record requirements.
$delivery$),
    ('a0310000-0000-4000-8000-000000000006'::uuid, 'Contractor Services Agreement and Compliance Undertaking', $agreement$
BNT LOGISTICS — CONTRACTOR SERVICES AGREEMENT AND COMPLIANCE UNDERTAKING

This electronic acknowledgement applies to a contractor driver linked to the contractor company shown in the Driver Portal. Read the current company agreement document displayed in the Contractor Company section before signing. The signed record captures the contractor driver's authenticated account, policy version and signing time.

The contractor confirms that they are authorised to accept the company agreement on their own behalf, will comply with applicable BNT site, safety, delivery, privacy, security and Chain of Responsibility requirements, will keep required licences and company insurance current, and will promptly report changes, incidents, hazards or compliance failures. This acknowledgement does not replace professional advice or alter any separate executed agreement between the parties.

If no current agreement document is displayed, do not sign this undertaking; ask the contractor administrator to upload the current agreement. The company agreement must have a recorded expiry date and admin approval before contractor onboarding can be finally approved.
$agreement$)
  ) AS v(id, title, content)
), inserted AS (
  INSERT INTO public.policies (
    id, title, name, version, version_label, content, audience, target_role,
    policy_group_id, status, is_published, published_at
  )
  SELECT s.id, s.title, s.title, '1.0', '1.0', s.content,
         CASE WHEN s.id = 'a0310000-0000-4000-8000-000000000006'::uuid THEN 'contractor' ELSE 'all' END,
         'driver', s.id, 'published', true, now()
  FROM policy_seed s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.policies p
    WHERE lower(coalesce(nullif(p.name, ''), p.title)) = lower(s.title)
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO public.policy_versions (policy_id, version_label, content, published_at)
SELECT p.id, coalesce(nullif(p.version_label, ''), '1.0'), p.content, coalesce(p.published_at, now())
FROM public.policies p
JOIN policy_seed s ON lower(coalesce(nullif(p.name, ''), p.title)) = lower(s.title)
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_versions pv
  WHERE pv.policy_id = p.id AND pv.version_label = coalesce(nullif(p.version_label, ''), '1.0')
);

-- Add only missing training topics. Existing fatigue, vehicle inspection,
-- incident, load restraint and CoR lessons remain untouched and required by
-- the current induction completion gate.
WITH modules AS (
  SELECT * FROM (VALUES
    ('Emergency and Evacuation', 'Review the current evacuation map and site instructions for each depot or customer site before work begins.',
     ARRAY['Identify the alarm and how to raise it.', 'Confirm the primary and alternate safe exit routes with the site warden.', 'Locate the assembly point on the current posted/site-course map; never guess.', 'Call 000 for immediate danger or serious injury; follow warden instructions and do not re-enter until told safe.', 'Site administrators must attach the current evacuation map and enter site-specific route/assembly details in the existing Site Induction course.']),
    ('IT and Acceptable Use', 'Protect BNT accounts, devices, email and information from misuse and cyber incidents.',
     ARRAY['Use unique passwords and MFA where available; never share credentials or codes.', 'Lock company devices and shared terminals; do not disable security or install unapproved software.', 'Use only authorised portal permissions and approved storage; do not forward work data to personal accounts.', 'Check email recipients and attachments and treat unexpected links as suspicious.', 'Report phishing, lost devices, exposed passwords, malware or misdirected data promptly to a supervisor or BNT manager.']),
    ('Drug and Alcohol Fitness for Work', 'Recognise impairment risk and take safe action before driving or safety-sensitive work.',
     ARRAY['Never drive or perform safety-sensitive work while impaired by alcohol, illicit drugs, misused medication or another substance.', 'Ask a prescriber or pharmacist about medication impacts and notify a supervisor before affected duties.', 'Stop work and move to a safe place if unfit for duty; notify a supervisor or another BNT manager if needed.', 'Contractors must also notify their employer/company supervisor.', 'Do not pressure or retaliate against someone who raises a genuine safety concern.']),
    ('Mobile Phone Safety', 'Avoid distraction and follow safe phone-use rules around heavy vehicles and mobile plant.',
     ARRAY['Do not hold, handle, read, type or interact with a phone while driving.', 'Set navigation before moving; only use lawful hands-free controls when they do not distract.', 'Pull over in a safe, legal place before calls, messages, or route changes.', 'Keep clear of moving vehicles and machinery before using a phone.', 'Do not delay emergency assistance; call 000 when safe and practicable.']),
    ('Delivery Procedure', 'Complete safe, accurate pick-up and delivery work and report exceptions promptly.',
     ARRAY['Before departure confirm delivery details, route/site rules, vehicle condition, load restraint, mass limits and required documents.', 'At sites follow traffic, PPE, pedestrian and loading instructions; verify freight and secure it before moving.', 'At delivery verify the recipient/location and record times, quantities, damage and proof of delivery accurately.', 'Tell the supervisor/dispatcher promptly about delays, missing or damaged goods, unsafe conditions or disputes.', 'Stop if vehicle/load safety is compromised; call 000 for immediate danger and report incidents through Driver Portal → Incidents.'])
  ) AS v(title, intro, bullets)
)
INSERT INTO public.learning_sections (
  title, format, summary, video_url, video_duration_seconds, require_full_watch, sort_order
)
SELECT m.title, 'Required Policy Training',
       jsonb_build_object('intro', m.intro, 'bullets', m.bullets)::text,
       NULL, 0, false,
       (SELECT coalesce(max(sort_order), 0) FROM public.learning_sections)
       + row_number() OVER (ORDER BY m.title)
FROM modules m
WHERE NOT EXISTS (
  SELECT 1 FROM public.learning_sections ls WHERE lower(ls.title) = lower(m.title)
);

-- Add focused quiz knowledge checks only when equivalent questions are absent.
INSERT INTO public.quiz_questions (question, options, correct_answer, explanation, sort_order, category, is_critical)
SELECT q.question, q.options::jsonb, q.correct_answer, q.explanation, q.sort_order, q.category, q.is_critical
FROM (VALUES
 ('At a new site, what must a driver do before work starts?', '["Guess the nearest exit", "Review the current site evacuation map and confirm routes and assembly point with the site contact", "Wait for an alarm to find out", "Use the customer car park"]', 1, 'Review the current site plan and confirm site-specific routes and assembly point before starting.', 9101, 'Emergency and Evacuation', true),
 ('A driver receives a suspicious portal password reset email. What should they do?', '["Click the link and enter the password", "Forward it to colleagues", "Do not interact and promptly report it to a supervisor or BNT manager", "Delete all work emails"]', 2, 'Avoid suspicious links and report suspected phishing promptly.', 9102, 'IT and Acceptable Use', false),
 ('A driver may be impaired by medication. What is the safe response?', '["Drive slowly", "Stop safety-sensitive work and tell the supervisor before continuing", "Take extra medication", "Wait until a customer complains"]', 1, 'Do not undertake safety-sensitive work while impaired; notify the supervisor and seek advice.', 9103, 'Drug and Alcohol', true),
 ('When may a driver read or type a message?', '["At a red light", "While moving slowly", "After stopping in a safe, legal place", "When traffic is quiet"]', 2, 'Stop in a safe, legal place before interacting with the phone.', 9104, 'Mobile Phone Use', true),
 ('What should a driver do when delivered goods are damaged?', '["Hide the damage if delivery is nearly complete", "Record it accurately and promptly notify the supervisor/dispatcher and report it through the incident process", "Change the proof of delivery", "Leave without telling anyone"]', 1, 'Accurately record damage and promptly notify and report it.', 9105, 'Delivery Procedure', false)
) AS q(question, options, correct_answer, explanation, sort_order, category, is_critical)
WHERE NOT EXISTS (SELECT 1 FROM public.quiz_questions existing WHERE lower(existing.question) = lower(q.question));

NOTIFY pgrst, 'reload schema';
