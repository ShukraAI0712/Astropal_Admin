import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The service-role Supabase client. SERVER ONLY.
 *
 * This key bypasses row level security, so it never leaves the server: it is
 * read from `SUPABASE_SERVICE_ROLE_KEY` (deliberately NOT prefixed
 * `NEXT_PUBLIC_`, which would ship it in the browser bundle), and this module
 * is imported only by route handlers under `app/api`.
 *
 * It exists because the analytics this dashboard needs cannot be expressed
 * under RLS. "How many accounts signed up and then did nothing" is a question
 * about other people's rows by definition, and `auth.users` is not reachable
 * from a browser client at all. The gate is therefore in front of the key
 * rather than in the database: the route handler verifies the caller's JWT and
 * their `app_role` before it uses this client, and the analytics function
 * itself is granted to `service_role` only.
 *
 * Built lazily, on the first request rather than on import. A missing key is a
 * deployment mistake that should surface as a clear 500 from the one endpoint
 * that needs it - not as a failed build, which is what a module-scope throw
 * produces the moment anything collects page data without secrets present.
 */

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable.');
  }
  if (!serviceKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY environment variable. Set it in the Vercel ' +
        'project settings for Production, Preview and Development. It must NOT be ' +
        'prefixed NEXT_PUBLIC_.'
    );
  }

  client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
