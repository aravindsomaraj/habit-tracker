export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

export function validateImage(file) {
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const extension = Object.hasOwn(extensions, file?.type) ? extensions[file.type] : null;
  if (!extension) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Choose a non-empty image of 5 MB or less.');
  return extension;
}
