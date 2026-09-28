-- Run only after the new backend has been deployed and its public list/detail
-- endpoints have been checked against the legacy schema.
ALTER TABLE public.scam_templates
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER;
