import { createClient } from "@supabase/supabase-js";

// Hardcoded defaults — live Supabase project (mmizjhxxajhooslhyafb)
const DEFAULT_SUPABASE_URL = "https://mmizjhxxajhooslhyafb.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1taXpqaHh4YWpob29zbGh5YWZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzODYxNSwiZXhwIjoyMDk1NDE0NjE1fQ.JwePVNWyfBJOJARhwkf1c0Mg5BVehWLZNl6s6MbbDsw";

function getSafeSupabaseUrl(): string {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl) && !/placeholder|your_supabase|example/i.test(envUrl)) {
    try {
      new URL(envUrl);
      return envUrl;
    } catch {
      // ignore
    }
  }
  return DEFAULT_SUPABASE_URL;
}

function getSafeSupabaseAnonKey(): string {
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (envKey && envKey.length > 20 && !/placeholder|your_/i.test(envKey)) {
    return envKey;
  }
  return DEFAULT_SUPABASE_ANON_KEY;
}

export const supabase = createClient(getSafeSupabaseUrl(), getSafeSupabaseAnonKey(), {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
