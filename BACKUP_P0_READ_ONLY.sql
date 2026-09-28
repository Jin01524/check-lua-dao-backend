SELECT jsonb_build_object(
  'api_keys', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.api_keys t), '[]'::jsonb),
  'scam_templates', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.scam_templates t), '[]'::jsonb),
  'users', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.users t), '[]'::jsonb),
  'scan_logs', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.scan_logs t), '[]'::jsonb),
  'system_stats', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.system_stats t), '[]'::jsonb)
) AS snapshot;
