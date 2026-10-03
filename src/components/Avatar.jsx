import { useState } from 'react';
import { avatarUrl } from '../data/avatars.js';

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export function Avatar({ client, profile, large = false, alt }) {
  const url = avatarUrl(client, profile);
  // Remember which URL failed; a replacement immediately gets a fresh attempt.
  const [broken, setBroken] = useState('');
  const name = profile?.display_name || profile?.handle || '';
  const label = alt ?? (name ? `${name}'s avatar` : 'Default avatar');
  return <span className={`profile-avatar${large ? ' large' : ''}`}>
    {url && broken !== url
      ? <img src={url} alt={label} onError={() => setBroken(url)} referrerPolicy="no-referrer" />
      : <span role="img" aria-label={label}>{initials(name)}</span>}
  </span>;
}
