# Driver Induction System

An internal driver induction application for one transport organisation, backed by Supabase and a required Node API. It is a company control, not an NHVR accreditation or a substitute for operational supervision, competency assessment, or legal advice.

The system is designed for two everyday users:

- `admin`: creates driver accounts, tracks progress, resets induction for testing or retraining, exports reports, and verifies certificates
- `driver`: signs in, completes the induction in order, uploads documents, passes the quiz, signs the declaration, and downloads the certificate

## Project Structure

- [apps/web](/Users/ankur/Documents/Induction/apps/web): React + Vite frontend
- [apps/api](/Users/ankur/Documents/Induction/apps/api): Express backend for admin-only actions that require the Supabase service role key
- [supabase/schema.sql](/Users/ankur/Documents/Induction/supabase/schema.sql): database schema, storage rules, RLS policies, audit logging, seeded learning content, and quiz setup

## Main Features

- simple email and password login
- driver induction flow with autosave and step locking
- document upload to Supabase Storage
- quiz scoring with attempt history
- digital declaration with timestamp
- certificate generation and verification
- audit logs for important actions
- admin reporting, audit export, and driver timeline review
- reset induction action for safe end-to-end testing
- optional driver feedback after completion
- admin insight cards for trends, follow-up risk, and completion timing

## Setup

1. Create a Supabase project.
2. Run [supabase/schema.sql](/Users/ankur/Documents/Induction/supabase/schema.sql) in the Supabase SQL editor.
3. Copy [apps/web/.env.example](/Users/ankur/Documents/Induction/apps/web/.env.example) to `apps/web/.env.local`.
4. Copy [apps/api/.env.example](/Users/ankur/Documents/Induction/apps/api/.env.example) to `apps/api/.env`.
5. Fill in the environment variables shown below.
6. Create your first admin user in Supabase Auth.
7. Insert a matching row into `public.profiles` for that user with `role = 'admin'`.

## Environment Variables

Frontend in `apps/web/.env.local`:

```bash
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_API_BASE_URL=http://localhost:4000/api
VITE_ORGANIZATION_NAME=Your Transport Company
VITE_ORGANIZATION_LOGO_URL=https://your-company.example/logo.png
```

Backend in `apps/api/.env`:

```bash
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
APP_URL=http://localhost:5173
ORGANIZATION_NAME=Your Transport Company
ORGANIZATION_LOGO_URL=https://your-company.example/logo.png
PORT=4000
ALLOW_SELF_REGISTRATION=false
```

Email delivery uses Resend when `RESEND_API_KEY` is set, or SMTP when `SMTP_USER` and `SMTP_PASS` are configured. Vercel automated notifications require Resend.

## Run Locally

```bash
npm install
cd apps/api && npm run dev
cd apps/web && npm run dev
```

Suggested local ports:

- frontend: `5173`
- backend: `4000`

## Admin Guide

After signing in as an admin, you can:

- create a new driver account manually
- click `Use Test Details` to prefill a safe sample driver for testing
- edit driver contact details
- reset a driver password
- reset a driver induction back to step 1 for testing or retraining
- delete a driver account
- export driver reports and audit logs
- open a driver row to review timeline history, uploaded documents, and certificate details
- verify a certificate by pasting the verification code

### Step 3 Course Builder

Open **Site Induction Courses** in the admin dashboard and select a course topic. Use **Topic content sequence** to add text, video, image, PDF, and voice-over items; edit each item and use the up/down controls to set its order. Drivers see one item at a time with **Previous** and **Next** controls. Existing slide text and media are carried into the sequence when it is first edited or published.

Course topic content is stored in the existing `induction_slides.content_json` and published into the existing learning-module media JSON; no new database migration is needed. For uploaded assets, the `induction-assets` bucket and admin Storage policies must be configured. Apply [016_site_induction_asset_storage.sql](./supabase/migrations/016_site_induction_asset_storage.sql) for admin upload authorization and [018_module_video_uploads.sql](./supabase/migrations/018_module_video_uploads.sql) to allow video MIME types.

### COR Training and Induction Register

In **COR → Inductions & Training**, open **Employee/Subcontractor Register – Training and Induction** to search and view existing Safety Modules activity. The register reads started and completed module records from `learning_section_completions`, with names, roles, worker types, and module titles from existing profiles and learning sections. It is read-only and requires an authenticated admin session; no additional table or migration is needed. Trainer and notes are not stored in the existing module completion data.

### COR Training Acknowledgement

In **COR → Inductions & Training → Training Acknowledgement**, review existing Step 3 worker/presentation activity and its acknowledgement status. Pending rows are shown only for a real started or completed presentation. Drivers submit their own confirmation and drawn signature from Driver Dashboard → Induction → Step 3 after completing the specific presentation; Admin can only view the saved acknowledgement. Records are associated with the worker, presentation ID, and presentation version, and remain separate from the general Legal Sign-Off. Apply [045_training_acknowledgements.sql](./supabase/migrations/045_training_acknowledgements.sql) and [046_training_acknowledgement_access.sql](./supabase/migrations/046_training_acknowledgement_access.sql) after migration 044.

### Fatigue Awareness Assessment

Drivers complete the separate assessment from **Driver Dashboard → COR**. Apply [049_fatigue_awareness_assessments.sql](./supabase/migrations/049_fatigue_awareness_assessments.sql) followed by [050_seed_fatigue_awareness_questions.sql](./supabase/migrations/050_seed_fatigue_awareness_questions.sql) to create the protected assessment tables and seed the 10 approved questions. The API grades submissions server-side, requires all 10 answers for Competent status, and stores each attempt with an answer review snapshot. Admins can review each driver's score, status, completion date, numbered attempt history, and submitted/correct answers from **Admin Dashboard → COR → Fatigue Awareness**.

### Employee/Contractor Induction Record Acknowledgement

Admin creates an induction record for the selected worker in **COR → Inductions & Training → Employee/Contractor Induction Record**. Admin Step 5 reuses the worker's existing Driver Dashboard Legal Sign-Off and signed date from `induction_progress`, matched by profile ID; the signature is not copied into the induction record, and the driver is not asked to sign twice. Any record-specific acknowledgement evidence remains separate, and trainer signatures remain separate. The worker may still review their own record and submit the optional record-specific acknowledgement from **Driver Dashboard → COR → Employee/Contractor Induction Record**. This reuses the existing database structures; apply [044_employee_induction_records.sql](./supabase/migrations/044_employee_induction_records.sql). No additional table or migration is required.

### Safe Driving Plans

Admin creates and assigns a plan from **Admin Dashboard → COR → Inductions & Training → Safe Driving Plans**. Drivers open assigned plans from **Driver Dashboard → COR → My Trips → My Safe Driving Plans**, complete their checklist, and acknowledge with a signature. Status progresses from Draft to Assigned, then Acknowledged when the driver signs, and Completed when the scheduler signs. Admin can review the saved driver response; driver-owned fields are read-only on the Admin side. Safe Driving Plans reuse `cor_form_submissions` with `form_code = 'SDP'`; apply migrations [051_cor_form_submissions.sql](./supabase/migrations/051_cor_form_submissions.sql) through [057_safe_driving_plan_completion_status.sql](./supabase/migrations/057_safe_driving_plan_completion_status.sql) in order. Migrations 052, 053, 055, and 057 preserve existing status values when replacing the status constraint. Migration 054 limits plan visibility to Admin and the assigned driver and protects Admin-owned fields during driver updates; migration 057 updates this guard for the new signing statuses. Migration 056 repairs existing Safe Driving Plan rows whose assigned driver is recorded in the payload but whose `user_id` still points to the creator.

## Driver Guide

After signing in as a driver, the process is:

1. Confirm personal details.
2. Upload licence, medical certificate, and right-to-work evidence; wait for compliance approval.
3. Complete the server-recorded training modules.
4. Pass the server-graded quiz at its configured threshold, including all critical questions.
5. Accept the declaration and type a digital signature.
6. Download the certificate.

The system saves progress automatically, so drivers can close the browser and return later.

## Testing Checklist

These flows are worth checking before rollout:

- sign in as a driver and resume from the saved step
- upload an invalid file and confirm the error message is clear
- fail the quiz, retry it, and confirm attempt history updates
- disconnect the network during a save and confirm the retry messaging appears
- reset a driver induction from the admin dashboard and confirm the flow starts from step 1
- delete a driver and confirm the account is removed while audit logs remain
- verify a generated certificate from the admin dashboard
- create and assign a Safe Driving Plan, acknowledge it as the assigned driver, and verify the saved response as Admin (`node apps/web/tests/safeDrivingPlan.browser.mjs` runs the isolated browser workflow)

## Security Notes

- the frontend uses only the Supabase anon key
- the service role key stays in the backend only
- row level security is enabled across the main tables
- storage access is limited to the user’s folder unless the viewer is an admin
- audit logs are immutable and completed induction records are locked
- self-registration is disabled by default; enable it only for a separately approved invite-free process

## Deployment

Vercel (web and serverless API):

- deploy from the project root so the root `vercel.json` builds `apps/web` and includes the serverless API and scheduled job
- add the frontend variables and the backend variables listed below to the Vercel project settings

Self-hosted Express backend:

- deploy `apps/api` to any Node.js host
- add the backend environment variables on the server
- make sure `APP_URL` points to the deployed frontend
- set `VITE_API_BASE_URL` to this API's HTTPS origin; do not use the web `functions/api` fallback as the induction backend

Supabase:

- keep RLS enabled
- do not expose the service role key in the browser
- apply the numbered migrations in order for an existing database, including [037_automated_notifications.sql](./supabase/migrations/037_automated_notifications.sql), [039_learning_question_responses.sql](./supabase/migrations/039_learning_question_responses.sql), [045_training_acknowledgements.sql](./supabase/migrations/045_training_acknowledgements.sql), [046_training_acknowledgement_access.sql](./supabase/migrations/046_training_acknowledgement_access.sql), [049_fatigue_awareness_assessments.sql](./supabase/migrations/049_fatigue_awareness_assessments.sql), and [050_seed_fatigue_awareness_questions.sql](./supabase/migrations/050_seed_fatigue_awareness_questions.sql)
- Safe Driving Plans require [051_cor_form_submissions.sql](./supabase/migrations/051_cor_form_submissions.sql), [052_driver_fatigue_work_record_drafts.sql](./supabase/migrations/052_driver_fatigue_work_record_drafts.sql), [053_safe_driving_plans.sql](./supabase/migrations/053_safe_driving_plans.sql), [054_safe_driving_plan_permissions.sql](./supabase/migrations/054_safe_driving_plan_permissions.sql), [055_safe_driving_plan_assignment_status.sql](./supabase/migrations/055_safe_driving_plan_assignment_status.sql), [056_safe_driving_plan_assignment_backfill.sql](./supabase/migrations/056_safe_driving_plan_assignment_backfill.sql), and [057_safe_driving_plan_completion_status.sql](./supabase/migrations/057_safe_driving_plan_completion_status.sql) in order
- Driver Fatigue Work Record Audits reuse `cor_form_submissions` (`form_code = 'F-10'`). Apply [058_fatigue_work_record_audit_access.sql](./supabase/migrations/058_fatigue_work_record_audit_access.sql) after migration 057 to associate existing Admin audits with their driver and limit F-10 reads to that driver and Admins. Drivers can read, but not insert or update, Admin audit rows.
- migration 039 stores each driver's typed lesson-question answers on their profile; apply it before using text-input lesson questions
- course publishing requires [012_slide_course_builder.sql](./supabase/migrations/012_slide_course_builder.sql) and [015_module_extras_and_templates.sql](./supabase/migrations/015_module_extras_and_templates.sql); apply them in order if they are not already installed

Automated notifications:

- add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `ORGANIZATION_NAME`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` to the Vercel project environment
- set `CRON_SECRET` to a long, randomly generated secret; Vercel sends it as a Bearer token to the scheduled endpoint
- deploy from the repository root so `vercel.json` installs the daily 01:00 UTC `/api/notifications/cron` job
- check Vercel function logs and `public.notification_logs` after the first run; delivery failures retry on subsequent scheduled runs (daily, up to five attempts), then remain logged as `failed`
- notification deduplication is keyed per reminder window or submission, so rerunning a scheduled job will not resend already queued events

## Backup And Recovery

- enable automated backups or point-in-time recovery in Supabase before production rollout
- keep a secure copy of [supabase/schema.sql](/Users/ankur/Documents/Induction/supabase/schema.sql) with your deployment notes
- export critical tables regularly: `profiles`, `drivers`, `induction_progress`, `certificates`, `audit_logs`, and `driver_feedback`
- if recovery is needed, restore the database backup in Supabase first, then restart the API and frontend with the same environment variables
