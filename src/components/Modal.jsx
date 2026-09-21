export function Modal({ children, onClose, busy = false }) {
  return <div className="scrim" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="modal" inert={busy ? '' : undefined}>{children}</div>
  </div>;
}
