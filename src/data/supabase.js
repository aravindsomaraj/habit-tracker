import { createClient } from '@supabase/supabase-js';
import { createAuthStorage } from './authStorage.js';

let client;

export function getSupabaseClient() {
  if (client) return client;
  const config = window.APP_CONFIG || {};
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase configuration is missing. Check config.js and reload.');
  }
  if (typeof config.SUPABASE_PUBLISHABLE_KEY !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('Supabase requires a public sb_publishable_ key.');
  }
  try {
    if (typeof config.SUPABASE_URL !== 'string') throw new Error();
    const url = new URL(config.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
  } catch {
    throw new Error('Supabase project URL is invalid. Use the HTTPS project URL in config.js.');
  }
  client = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: createAuthStorage() },
  });
  return client;
}

export function resetSupabaseClientForTests() {
  client = undefined;
}
