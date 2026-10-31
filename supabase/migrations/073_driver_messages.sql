CREATE TABLE IF NOT EXISTS public.driver_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.driver_messages(id) ON DELETE CASCADE,
  subject text,
  message text NOT NULL,
  message_type text NOT NULL DEFAULT 'General Feedback',
  required_action text,
  status text NOT NULL DEFAULT 'Unread' CHECK (status IN ('Unread', 'Read', 'Replied', 'Closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS driver_messages_receiver_idx ON public.driver_messages (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_messages_sender_idx ON public.driver_messages (sender_id, created_at DESC);

ALTER TABLE public.driver_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.driver_messages TO service_role;

NOTIFY pgrst, 'reload schema';