-- P0 migration for the existing hosted Supabase project.
-- Apply only after a database backup and review of pending template content.
-- This migration does not delete or publish template records.
BEGIN;

-- Keep confidence_score for the post-backend migration. The currently running
-- Render backend filters on that column and hides legacy rows when it is NULL.
ALTER TABLE public.scam_templates
  ADD COLUMN IF NOT EXISTS warning_points JSONB DEFAULT '[]';
ALTER TABLE public.scam_templates
  ADD COLUMN IF NOT EXISTS attack_target TEXT DEFAULT 'Không rõ';
ALTER TABLE public.scam_templates
  ADD COLUMN IF NOT EXISTS exfiltration_vector TEXT DEFAULT 'none';
ALTER TABLE public.scam_templates
  ADD COLUMN IF NOT EXISTS multi_agent_debate JSONB;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.users
  DROP COLUMN IF EXISTS password_display;
ALTER TABLE public.system_stats
  ADD COLUMN IF NOT EXISTS active_model TEXT;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scam_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_stats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.api_keys, public.scam_templates, public.users,
  public.scan_logs, public.system_stats FROM anon, authenticated;

COMMIT;
