export const RESERVED_HANDLES = new Set(['admin', 'administrator', 'support', 'system', 'root', 'moderator', 'habittracker', 'habit_tracker']);

export function normalizeHandle(value = '') {
  return value.trim().toLowerCase().replace(/^@/, '');
}

export function handleError(handle, { allowReserved = false } = {}) {
  if (handle.length < 3) return 'Handle must be at least 3 characters.';
  if (handle.length > 24) return 'Handle must be at most 24 characters.';
  if (!/^[a-z0-9_]+$/.test(handle)) return 'Only letters, numbers and _ are allowed.';
  if (!allowReserved && RESERVED_HANDLES.has(handle)) return 'That handle is reserved. Choose another.';
  return '';
}

export function suggestHandle(email = '') {
  const prefix = email.split('@')[0].split('+')[0].toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return handleError(prefix) ? '' : prefix;
}
