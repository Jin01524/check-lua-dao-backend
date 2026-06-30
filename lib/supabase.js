/**
 * lib/supabase.js
 * Supabase client singleton - lazy initialized để tránh lỗi với ES Modules
 * (dotenv phải được load trước khi createClient() được gọi)
 */

import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabaseClient() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing Supabase config. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'
      );
    }

    _client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}
