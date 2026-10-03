import { useRef } from 'react';
import { IMAGE_TYPES } from '../lib/images.js';

export function AvatarControls({ social, disabled }) {
  const input = useRef(null);
  const busy = social.avatarBusy || social.profileSaving || disabled;
  return <div className="avatar-controls" aria-busy={social.avatarBusy || false}>
    <p className="tiny">Public photo · JPEG, PNG or WebP · up to 5 MB</p>
    <input ref={input} type="file" hidden aria-label="Profile photo" accept={IMAGE_TYPES} disabled={busy}
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) social.updateAvatar(file); }} />
    <div className="avatar-actions">
      <button type="button" className="pillbtn" disabled={busy} onClick={() => input.current?.click()}>{social.avatarBusy ? 'Updating photo…' : social.profile.avatar_path ? 'Change photo' : 'Upload photo'}</button>
      {social.profile.avatar_path && <button type="button" className="pillbtn" disabled={busy} onClick={() => social.updateAvatar(null)}>Remove photo</button>}
      {!!social.avatarCleanup?.length && <button type="button" className="pillbtn" disabled={busy} onClick={() => social.updateAvatar(undefined, social.avatarCleanup)}>Retry file cleanup</button>}
    </div>
    {social.avatarMessage && <p className="tiny" role="status">{social.avatarMessage}</p>}
  </div>;
}
