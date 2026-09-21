import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteHabitRow, insertHabit, loadHabitData, writeEntryRow } from '../data/habits.js';
import { clearPhotoCache, deleteHabitPhotos, removeProofPhoto, replaceProofPhoto } from '../data/photos.js';

const saveError = (error) => `Could not save your change. ${error.message || 'Please check your connection.'} Reload to check the saved data before retrying.`;

export function useHabits(client, userId) {
  const [habits, setHabits] = useState([]);
  const [entries, setEntries] = useState({});
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Loading your habits…');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const habitsRef = useRef([]);

  useEffect(() => { habitsRef.current = habits; }, [habits]);

  useEffect(() => {
    const current = ++generation.current;
    clearPhotoCache();
    busyRef.current = false;
    setBusy(false);
    setHabits([]);
    setEntries({});
    setStatus('loading');
    setMessage('Loading your habits…');
    let active = true;
    loadHabitData(client, userId, () => active && current === generation.current).then((loaded) => {
      if (!active || current !== generation.current) return;
      setHabits(loaded.habits);
      setEntries(loaded.entries);
      setStatus('ready');
      setMessage('');
    }).catch((error) => {
      if (!active || current !== generation.current) return;
      setStatus('error');
      setMessage(`Could not load your habits. Reload to retry. ${error.message || 'Please check your connection.'}`);
    });
    return () => {
      active = false;
      generation.current += 1;
      clearPhotoCache();
    };
  }, [client, userId]);

  const write = useCallback(async (action) => {
    if (busyRef.current) return { ok: false };
    if (status !== 'ready') {
      setMessage('Your habits are not loaded yet. Reload if loading failed.');
      return { ok: false };
    }
    const current = generation.current;
    busyRef.current = true;
    setBusy(true);
    setMessage('Saving…');
    try {
      const result = await action(() => {
        if (current !== generation.current) throw new Error('Your account changed. Please retry after signing in.');
      });
      if (current !== generation.current) return { ok: false };
      setMessage(result.warning || '');
      return { ok: true, ...result };
    } catch (error) {
      if (current === generation.current) setMessage(saveError(error));
      return { ok: false, error };
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [status]);

  const createHabit = useCallback((habit) => write(async () => {
    const saved = await insertHabit(client, userId, habit);
    setHabits((current) => [...current, saved]);
    setEntries((current) => ({ ...current, [saved.id]: {} }));
    return { habit: saved };
  }), [client, userId, write]);

  const saveEntry = useCallback((habit, entryDate, patch) => write(async () => {
    if (!habit || !habitsRef.current.some((item) => item.id === habit.id)) throw new Error('This habit is no longer available.');
    const saved = await writeEntryRow(client, habit, entryDate, patch);
    setEntries((current) => ({ ...current, [habit.id]: { ...(current[habit.id] || {}), [entryDate]: saved } }));
    return { entry: saved };
  }), [client, write]);

  const uploadPhoto = useCallback((habit, entryDate, file) => write(async (ensureCurrent) => {
    if (!habit || !habitsRef.current.some((item) => item.id === habit.id)) throw new Error('This habit is no longer available.');
    const result = await replaceProofPhoto(client, userId, habit, entryDate, file, ensureCurrent);
    setEntries((current) => ({ ...current, [habit.id]: { ...(current[habit.id] || {}), [entryDate]: result.entry } }));
    return result;
  }), [client, userId, write]);

  const removePhoto = useCallback((habit, entryDate) => write(async (ensureCurrent) => {
    if (!habit || !habitsRef.current.some((item) => item.id === habit.id)) throw new Error('This habit is no longer available.');
    const saved = await removeProofPhoto(client, userId, habit, entryDate, ensureCurrent);
    setEntries((current) => ({ ...current, [habit.id]: { ...(current[habit.id] || {}), [entryDate]: saved } }));
    return { entry: saved };
  }), [client, userId, write]);

  const deleteHabit = useCallback((habit) => write(async (ensureCurrent) => {
    if (!habit || !habitsRef.current.some((item) => item.id === habit.id)) throw new Error('This habit is no longer available.');
    await deleteHabitPhotos(client, userId, habit.id, () => {
      try { ensureCurrent(); return true; } catch { return false; }
    });
    ensureCurrent();
    await deleteHabitRow(client, userId, habit.id);
    setHabits((current) => current.filter((item) => item.id !== habit.id));
    setEntries((current) => { const next = { ...current }; delete next[habit.id]; return next; });
    return {};
  }), [client, userId, write]);

  return { habits, entries, status, message, busy, createHabit, saveEntry, uploadPhoto, removePhoto, deleteHabit };
}
