import { useEffect } from 'react';

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(onDone, 1900);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  if (!message) return null;
  return <div className="react-toast">{message}</div>;
}

export function Confetti({ burst }) {
  if (!burst) return null;
  const colors = ['#58cc02', '#8b5cf6', '#1cb0f6', '#ffc800', '#ff4b7d'];
  return <>{Array.from({ length: 34 }, (_, index) => <i key={`${burst}-${index}`} className="conf" style={{
    left: `${Math.random() * 100}vw`, background: colors[index % colors.length],
    animationDuration: `${1.4 + Math.random() * 1.1}s`, animationDelay: `${Math.random() * .25}s`,
    borderRadius: index % 3 === 0 ? '50%' : undefined,
  }} />)}</>;
}
