import { beforeEach, describe, expect, it } from 'vitest';
import { getSupabaseClient, resetSupabaseClientForTests } from '../src/data/supabase.js';

describe('browser Supabase configuration', () => {
  beforeEach(() => resetSupabaseClientForTests());

  it('requires both public values and rejects secret keys', () => {
    window.APP_CONFIG = {};
    expect(() => getSupabaseClient()).toThrow('missing');
    window.APP_CONFIG = { SUPABASE_URL: 'https://project.example', SUPABASE_PUBLISHABLE_KEY: `sb_${'secret'}_private` };
    expect(() => getSupabaseClient()).toThrow('public sb_publishable_');
  });

  it('rejects non-root or credential-bearing project URLs', () => {
    const key = 'sb_publishable_test';
    for (const url of ['https://project.example/path', 'https://user:password@project.example/', 'javascript:alert(1)']) {
      window.APP_CONFIG = { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key };
      expect(() => getSupabaseClient()).toThrow('invalid');
      resetSupabaseClientForTests();
    }
  });

  it('creates a singleton with a valid publishable configuration', () => {
    window.APP_CONFIG = { SUPABASE_URL: 'https://project.example', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
    expect(getSupabaseClient()).toBe(getSupabaseClient());
  });
});
