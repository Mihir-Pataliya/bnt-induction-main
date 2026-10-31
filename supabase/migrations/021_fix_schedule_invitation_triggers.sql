-- Fix schedule invitations for all supported trigger types. The deployed
-- function only handled after_enrollment and silently skipped after_completion.
ALTER TABLE public.induction_schedule_invitations
  DROP CONSTRAINT IF EXISTS induction_schedule_invitations_status_check;

ALTER TABLE public.induction_schedule_invitations
  ADD CONSTRAINT induction_schedule_invitations_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced'));

CREATE OR REPLACE FUNCTION public.process_induction_schedule_invitations()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  enrollment RECORD;
  schedule_item RECORD;
  existing_invitation RECORD;
  driver_email TEXT;
  driver_name TEXT;
  item_title TEXT;
  due_date TIMESTAMPTZ;
  last_completion TIMESTAMPTZ;
  invitations_created INT := 0;
BEGIN
  FOR enrollment IN
    SELECT e.*, s.name AS schedule_name
    FROM public.induction_schedule_enrollments e
    JOIN public.induction_schedules s ON e.schedule_id = s.id
    WHERE e.status = 'active'
      AND s.is_active = true
  LOOP
    SELECT *
    INTO schedule_item
    FROM public.induction_schedule_items
    WHERE schedule_id = enrollment.schedule_id
      AND sequence_order = enrollment.current_item_index + 1
    ORDER BY sequence_order
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO existing_invitation
    FROM public.induction_schedule_invitations
    WHERE enrollment_id = enrollment.id
      AND schedule_item_id = schedule_item.id
      AND status IN ('pending', 'sent', 'delivered', 'opened', 'clicked')
    LIMIT 1;

    IF FOUND THEN
      CONTINUE;
    END IF;

    CASE schedule_item.delay_type
      WHEN 'fixed_date' THEN
        IF schedule_item.fixed_date IS NOT NULL AND now() < schedule_item.fixed_date THEN
          CONTINUE;
        END IF;
        due_date := COALESCE(schedule_item.fixed_date, now());

      WHEN 'after_enrollment' THEN
        due_date := enrollment.enrolled_at
          + COALESCE(schedule_item.delay_days, 0) * INTERVAL '1 day';
        IF now() < due_date THEN
          CONTINUE;
        END IF;

      WHEN 'after_completion' THEN
        IF enrollment.current_item_index > 0 THEN
          SELECT completed_at
          INTO last_completion
          FROM public.induction_progress
          WHERE user_id = enrollment.driver_id
          ORDER BY completed_at DESC
          LIMIT 1;

          IF last_completion IS NULL THEN
            CONTINUE;
          END IF;

          due_date := last_completion
            + COALESCE(schedule_item.delay_days, 0) * INTERVAL '1 day';
          IF now() < due_date THEN
            CONTINUE;
          END IF;
        ELSE
          -- The first item has no previous completion, so it starts at enrollment.
          due_date := enrollment.enrolled_at;
          IF now() < due_date THEN
            CONTINUE;
          END IF;
        END IF;

      ELSE
        CONTINUE;
    END CASE;

    IF schedule_item.expiry_interval IS NOT NULL THEN
      SELECT MAX(completed_at)
      INTO last_completion
      FROM public.induction_progress
      WHERE user_id = enrollment.driver_id;

      IF last_completion IS NOT NULL
         AND (now() - last_completion) < schedule_item.expiry_interval THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT email, full_name
    INTO driver_email, driver_name
    FROM public.profiles
    WHERE id = enrollment.driver_id;

    item_title := COALESCE(schedule_item.title, 'Induction');

    INSERT INTO public.induction_schedule_invitations (
      enrollment_id,
      schedule_item_id,
      delivery_method,
      status,
      metadata
    ) VALUES (
      enrollment.id,
      schedule_item.id,
      'in_app',
      'pending',
      jsonb_build_object(
        'driver_email', driver_email,
        'driver_name', driver_name,
        'item_title', item_title,
        'schedule_name', enrollment.schedule_name,
        'due_date', due_date,
        'expiry_interval', schedule_item.expiry_interval
      )
    );

    invitations_created := invitations_created + 1;

    UPDATE public.induction_schedule_enrollments
    SET current_item_index = enrollment.current_item_index + 1,
        updated_at = now()
    WHERE id = enrollment.id;
  END LOOP;

  RETURN invitations_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_induction_schedule_invitations() TO authenticated;
