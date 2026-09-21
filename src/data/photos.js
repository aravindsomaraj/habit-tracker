import { readPages, writeEntryRow } from './habits.js';

const PROOF_BUCKET = 'proof-photos';
const photoUrls = new Map();

export function clearPhotoCache() {
  photoUrls.clear();
}

export function checkPhotoPath(path, owner) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  if (parts[0] !== owner || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('This photo path does not belong to the signed-in account.');
  }
}

const bucket = (client) => client.storage.from(PROOF_BUCKET);

async function deletePhotoObjects(client, owner, paths) {
  paths.forEach((path) => checkPhotoPath(path, owner));
  if (!paths.length) return;
  const result = await bucket(client).remove(paths);
  if (result.error) throw result.error;
  paths.forEach((path) => photoUrls.delete(path));
}

async function currentPhotoPath(client, habitId, entryDate) {
  const result = await client.from('habit_entries').select('photo_path')
    .eq('habit_id', habitId).eq('entry_date', entryDate).maybeSingle();
  if (result.error) throw result.error;
  return result.data?.photo_path || null;
}

export async function replaceProofPhoto(client, owner, habit, entryDate, file, ensureCurrent = () => {}) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const extension = extensions[file.type];
  if (!extension) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Choose a non-empty image of 5 MB or less.');
  const previous = await currentPhotoPath(client, habit.id, entryDate);
  ensureCurrent();
  if (previous) checkPhotoPath(previous, owner);
  const path = `${owner}/${habit.id}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await bucket(client).upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) throw uploaded.error;
  let saved;
  try {
    ensureCurrent();
    saved = await writeEntryRow(client, habit, entryDate, { photo: path });
  } catch (error) {
    try { await deletePhotoObjects(client, owner, [path]); }
    catch (cleanup) { throw new Error(`${error.message} The uploaded file also could not be cleaned up: ${cleanup.message}`); }
    throw error;
  }
  ensureCurrent();
  let warning = '';
  if (previous) {
    try { await deletePhotoObjects(client, owner, [previous]); }
    catch (error) { warning = `Your new photo was saved, but the previous file could not be deleted: ${error.message}`; }
  }
  return { entry: saved, warning };
}

export async function removeProofPhoto(client, owner, habit, entryDate, ensureCurrent = () => {}) {
  const path = await currentPhotoPath(client, habit.id, entryDate);
  ensureCurrent();
  if (path) await deletePhotoObjects(client, owner, [path]);
  ensureCurrent();
  try {
    return await writeEntryRow(client, habit, entryDate, { photo: null });
  } catch (error) {
    throw new Error(`The photo file was removed, but its entry could not be cleared. Retry removing the photo. ${error.message}`);
  }
}

export async function deleteHabitPhotos(client, owner, habitId, isCurrent = () => true) {
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error('Your account changed. Please retry after signing in.');
  };
  const rows = await readPages(
    () => client.from('habit_entries').select('id,photo_path').eq('habit_id', habitId).order('id'),
    isCurrent,
  );
  ensureCurrent();
  let paths = rows.filter((row) => row.photo_path).map((row) => row.photo_path);
  async function collect(prefix) {
    let offset = 0;
    while (true) {
      ensureCurrent();
      const result = await bucket(client).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (result.error) throw result.error;
      if (!result.data.length) break;
      for (const item of result.data) {
        if (item.id) paths.push(`${prefix}/${item.name}`);
        else await collect(`${prefix}/${item.name}`);
      }
      offset += result.data.length;
    }
  }
  await collect(`${owner}/${habitId}`);
  paths = [...new Set(paths)];
  for (let index = 0; index < paths.length; index += 100) {
    ensureCurrent();
    await deletePhotoObjects(client, owner, paths.slice(index, index + 100));
  }
}

export async function signedPhoto(client, owner, path, force = false) {
  checkPhotoPath(path, owner);
  const cached = photoUrls.get(path);
  if (!force && cached?.expires > Date.now()) return cached.promise;
  const record = { expires: Date.now() + 55 * 60 * 1000 };
  record.promise = bucket(client).createSignedUrl(path, 3600).then((result) => {
    if (result.error) throw result.error;
    if (!result.data?.signedUrl) throw new Error('No photo download URL was returned.');
    return { url: result.data.signedUrl, expires: record.expires };
  }).catch((error) => {
    if (photoUrls.get(path) === record) photoUrls.delete(path);
    throw error;
  });
  photoUrls.set(path, record);
  return record.promise;
}
