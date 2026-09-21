export function Banner({ children }) {
  if (!children) return null;
  return <div className="banner" role="status" aria-live="polite">{children}</div>;
}
