import { validateImage } from '../lib/images.js';

export const AVATAR_BUCKET = 'avatars';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const pathPattern = new RegExp(`^${uuid}/${uuid}\\.(jpg|png|webp)$`);

export function isAvatarPath(path, owner) {
  return typeof path === 'string' && pathPattern.test(path) && path.split('/')[0] === owner;
}

export function avatarUrl(client, profile) {
  const owner = profile?.id || profile?.user_id;
  if (!client || !isAvatarPath(profile?.avatar_path, owner)) return '';
  return client.storage.from(AVATAR_BUCKET).getPublicUrl(profile.avatar_path).data.publicUrl;
}

async function ownProfile(client, owner, ensureCurrent) {
  ensureCurrent();
  const { data, error } = await client.rpc('own_profile_settings');
  ensureCurrent();
  if (error) throw error;
  if (data?.[0]?.id !== owner) throw new Error('Your account changed. Reload your profile.');
  return data[0];
}

async function removeObject(client, owner, path, ensureCurrent) {
  ensureCurrent();
  if (!isAvatarPath(path, owner)) throw new Error('This avatar does not belong to your account.');
  const { error } = await client.storage.from(AVATAR_BUCKET).remove([path]);
  ensureCurrent();
  // Storage remove is idempotent, including an already missing object.
  if (error) throw error;
}

export async function cleanupAvatar(client, owner, path, ensureCurrent = () => {}) {
  const current = await ownProfile(client, owner, ensureCurrent);
  if (current.avatar_path === path) throw new Error('This file is your current photo. Reload your profile before retrying.');
  await removeObject(client, owner, path, ensureCurrent);
}

// file=null removes the avatar. Clear/save metadata before deleting any old
// object, so failed writes never leave the profile pointing to a deleted file.
export async function changeAvatar(client, owner, file, ensureCurrent = () => {}) {
  const extension = file === null ? null : validateImage(file);
  const previous = (await ownProfile(client, owner, ensureCurrent)).avatar_path || null;
  const path = file === null ? null : `${owner}/${crypto.randomUUID()}.${extension}`;
  if (file !== null) {
    ensureCurrent();
    const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    ensureCurrent();
    if (error) throw error;
  }
  let profile;
  try {
    ensureCurrent();
    const { data, error } = await client.rpc('set_profile_avatar', { new_avatar_path: path, expected_avatar_path: previous });
    ensureCurrent();
    if (error) throw error;
    if (data?.[0]?.id !== owner || (data[0].avatar_path || null) !== path) throw new Error('Could not confirm your photo was saved.');
    profile = data[0];
  } catch (failure) {
    ensureCurrent();
    // A lost response can follow a committed RPC. Re-read before deciding
    // whether to delete the upload; never guess and delete a referenced file.
    let current;
    try { current = await ownProfile(client, owner, ensureCurrent); }
    catch {
      ensureCurrent();
      const error = new Error(`Could not confirm your photo change. Reload your profile before retrying. ${path ? 'The uploaded file was kept to avoid losing your photo.' : 'No file was deleted.'}`);
      error.cleanupPath = path;
      throw error;
    }
    if ((current.avatar_path || null) === path) profile = current;
    else {
      const error = new Error(failure.message || 'Could not save your photo.');
      if (path) {
        try { await removeObject(client, owner, path, ensureCurrent); }
        catch { ensureCurrent(); error.cleanupPath = path; error.message += ' The unused upload could not be deleted. Retry file cleanup.'; }
      }
      throw error;
    }
  }
  let warning = '', cleanupPath = null;
  if (previous && previous !== path) {
    try { await cleanupAvatar(client, owner, previous, ensureCurrent); }
    catch {
      ensureCurrent();
      warning = 'Your profile was updated, but the previous public file could not be deleted. Retry file cleanup.';
      cleanupPath = previous;
    }
  }
  return { profile, warning, cleanupPath };
}
