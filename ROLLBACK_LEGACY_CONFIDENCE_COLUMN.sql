-- Restore the legacy Render backend list query until the new backend is deployed.
-- The old backend filters confidence_score >= 40 when the column exists;
-- existing records had no score, so adding the column made its list empty.
BEGIN;
LOCK TABLE public.scam_templates IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scam_templates WHERE confidence_score IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot drop confidence_score because populated values exist';
  END IF;
END
$$;
ALTER TABLE public.scam_templates DROP COLUMN confidence_score;
COMMIT;
