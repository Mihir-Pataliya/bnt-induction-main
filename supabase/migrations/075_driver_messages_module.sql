ALTER TABLE public.driver_messages ADD COLUMN IF NOT EXISTS module text NOT NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS driver_messages_module_idx ON public.driver_messages (receiver_id, module, created_at DESC);
NOTIFY pgrst, 'reload schema';