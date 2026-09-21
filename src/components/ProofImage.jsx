import { useCallback, useEffect, useRef, useState } from 'react';
import { signedPhoto } from '../data/photos.js';

export function ProofImage({ client, userId, path, alt }) {
  const [state, setState] = useState({ status: 'loading', url: '', error: '' });
  const attempt = useRef(0);

  const load = useCallback((force = false) => {
    const current = ++attempt.current;
    setState({ status: 'loading', url: '', error: '' });
    signedPhoto(client, userId, path, force).then(({ url, expires }) => {
      if (current !== attempt.current) return;
      setState({ status: 'image', url, error: '', expires });
    }).catch((error) => {
      if (current === attempt.current) setState({ status: 'error', url: '', error: error.message });
    });
  }, [client, path, userId]);

  useEffect(() => {
    load();
    return () => { attempt.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!state.expires) return undefined;
    const delay = Math.max(1000, state.expires - Date.now());
    const timer = window.setTimeout(() => load(), delay);
    return () => window.clearTimeout(timer);
  }, [load, state.expires]);

  return <span className="proof-image">
    {state.url && <img src={state.url} alt={alt} hidden={state.status !== 'ready'} onLoad={() => setState((value) => ({ ...value, status: 'ready' }))} onError={() => setState({ status: 'error', url: '', error: 'Check your connection or retry the photo.' })} />}
    {state.status !== 'ready' && <span className="tiny" role="status">{state.status === 'error' ? `Could not load photo. ${state.error}` : 'Loading photo…'}</span>}
    {state.status === 'error' && <button className="pillbtn" type="button" onClick={() => load(true)}>Retry photo</button>}
  </span>;
}
