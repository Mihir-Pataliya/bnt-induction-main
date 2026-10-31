CREATE TABLE IF NOT EXISTS public.notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  event_type text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_logs_dispatch_idx
  ON public.notification_logs (status, next_attempt_at, created_at);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_logs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pending_notifications(batch_size integer DEFAULT 25)
RETURNS SETOF public.notification_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT n.id
    FROM public.notification_logs n
    WHERE (n.status = 'pending' AND n.next_attempt_at <= now())
       OR (n.status = 'processing' AND n.locked_at <= now() - interval '10 minutes')
    ORDER BY n.next_attempt_at, n.created_at
    LIMIT least(greatest(batch_size, 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_logs n
  SET status = 'processing',
      attempt_count = n.attempt_count + 1,
      locked_at = now(),
      updated_at = now()
  FROM candidates c
  WHERE n.id = c.id
  RETURNING n.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_notifications(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
