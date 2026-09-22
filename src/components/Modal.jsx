import { useEffect, useRef } from 'react';

export function Modal({ children, onClose, busy = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="scrim" aria-label="Habit Tracker dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="modal" aria-busy={busy} inert={busy ? '' : undefined}>{children}</div>
  </dialog>;
}
