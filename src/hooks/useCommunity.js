import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../data/community.js';

export function useCommunity(client, userId, onRelationshipChange) {
  const [preferences, setPreferences] = useState({ enabled: false, habits: [] });
  const [settingsStatus, setSettingsStatus] = useState('loading');
  const [settingsError, setSettingsError] = useState('');
  const [feed, setFeed] = useState([]), [status, setStatus] = useState('idle');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [hasMore, setHasMore] = useState(false), [busy, setBusy] = useState(false);
  const generation = useRef(0), request = useRef(0), pending = useRef(false), feedRef = useRef([]), feedLoading = useRef(false);
  const relationshipRef = useRef(onRelationshipChange);
  relationshipRef.current = onRelationshipChange;
  const refreshPreferences = useCallback(async () => {
    const current = generation.current;
    try {
      const next = await api.loadCommunityPreferences(client, userId);
      if (current !== generation.current) return;
      setPreferences(next); setSettingsStatus('ready'); setSettingsError('');
    } catch (failure) {
      if (current === generation.current) { setSettingsStatus('error'); setSettingsError(failure.message || 'Community settings unavailable.'); }
    }
  }, [client, userId]);
  useEffect(() => {
    ++generation.current; ++request.current; pending.current = false; feedLoading.current = false;
    setPreferences({ enabled: false, habits: [] }); setSettingsStatus('loading');
    setFeed([]); feedRef.current = []; setStatus('idle'); setError(''); setMessage(''); setHasMore(false); setBusy(false);
    refreshPreferences();
    return () => { ++generation.current; ++request.current; };
  }, [refreshPreferences]);
  const refresh = useCallback(async (more = false) => {
    if (more && feedLoading.current) return;
    const current = generation.current, ticket = ++request.current;
    const previous = feedRef.current;
    feedLoading.current = true; setStatus('loading'); setError('');
    try {
      const rows = await api.loadCommunityFeed(client, more ? previous.at(-1) : null);
      if (current !== generation.current || ticket !== request.current) return;
      const next = more ? [...new Map([...previous, ...rows].map(row => [row.id, row])).values()] : rows;
      feedRef.current = next; setFeed(next); setHasMore(rows.length === 20); setStatus('ready');
    } catch (failure) {
      if (current === generation.current && ticket === request.current) { setStatus('error'); setError(failure.message || 'Could not load community updates.'); }
    } finally {
      if (current === generation.current && ticket === request.current) feedLoading.current = false;
    }
  }, [client]);
  const mutate = useCallback(async (action, success, relationship = false) => {
    if (pending.current) return false;
    const current = generation.current;
    pending.current = true; setBusy(true); setMessage('');
    try {
      await action();
      if (current !== generation.current) return false;
      setMessage(success); await refreshPreferences(); await refresh();
      if (relationship) relationshipRef.current?.();
      return true;
    } catch (failure) {
      if (current === generation.current) setMessage(failure.message || 'Could not update community settings.');
      return false;
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false); }
    }
  }, [refreshPreferences, refresh]);
  const loadProfile = useCallback(target => api.loadCommunityProfile(client, target), [client]);
  return {
    ...preferences, settingsStatus, settingsError, refreshPreferences,
    feed, status, error, message, hasMore, busy, refresh, loadProfile,
    setEnabled: enabled => mutate(() => api.setCommunityEnabled(client, enabled), enabled ? 'Community participation enabled. Choose the habits to publish.' : 'Community participation disabled. Published updates removed.'),
    setHabit: (habit, enabled) => mutate(() => api.setCommunityHabit(client, habit, enabled), enabled ? 'New completions for this habit will be published.' : 'Community updates for this habit removed.'),
    block: target => mutate(() => api.blockCommunityUser(client, target), 'User blocked.', true),
    report: (activity, reason) => mutate(() => api.reportCommunityActivity(client, activity, reason), 'Report submitted. Updates from this user are now hidden.'),
  };
}
