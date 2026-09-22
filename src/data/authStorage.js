// Supabase normally persists the entire session, including optional Google API
// tokens. We only need Supabase credentials; discard provider tokens at storage.
function withoutProviderTokens(value) {
  try {
    const session = JSON.parse(value);
    if (session && typeof session === 'object' && ('provider_token' in session || 'provider_refresh_token' in session)) {
      delete session.provider_token;
      delete session.provider_refresh_token;
      return JSON.stringify(session);
    }
  } catch { /* Non-session SDK storage values are left intact. */ }
  return value;
}

export function createAuthStorage() {
  const memory = new Map();
  let memoryOnly = false;
  return {
    getItem(key) {
      if (!memoryOnly) {
        try {
          const raw = window.localStorage.getItem(key);
          const value = withoutProviderTokens(raw);
          memory.set(key, value);
          if (value !== raw) window.localStorage.setItem(key, value);
          return value;
        } catch { memoryOnly = true; }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, raw) {
      const value = withoutProviderTokens(raw);
      memory.set(key, value);
      if (!memoryOnly) {
        try { window.localStorage.setItem(key, value); } catch { memoryOnly = true; }
      }
    },
    removeItem(key) {
      memory.delete(key);
      if (!memoryOnly) {
        try { window.localStorage.removeItem(key); } catch { memoryOnly = true; }
      }
    },
  };
}
