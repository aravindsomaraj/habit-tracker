import { handleError, normalizeHandle } from '../lib/handles.js';

export const PROFILE_FIELDS = 'id,handle,display_name,avatar_path';

export async function loadProfile(client, userId) {
  const { data, error } = await client.from('profiles').select(PROFILE_FIELDS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function checkHandle(client, value) {
  const candidate = normalizeHandle(value);
  const validation = handleError(candidate);
  if (validation) throw new Error(validation);
  const { data, error } = await client.rpc('handle_available', { candidate });
  if (error) throw new Error('Unable to check availability. Please try again.');
  return data === true;
}

export async function claimHandle(client, value) {
  const candidate = normalizeHandle(value);
  const validation = handleError(candidate);
  if (validation) throw new Error(validation);
  const { data, error } = await client.rpc('claim_handle', { candidate });
  if (error) {
    if (error.code === '23505') throw new Error('That handle is already taken. Choose another.');
    if (error.code === '23514') throw new Error('That handle is invalid or reserved. Choose another.');
    throw new Error('Unable to save your handle. Please try again.');
  }
  const profile = data?.[0];
  if (!profile?.handle) throw new Error('Unable to save your handle. Please try again.');
  return profile;
}
