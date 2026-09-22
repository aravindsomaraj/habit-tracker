import { useEffect } from 'react';

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(onDone, 1900);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  if (!message) return null;
  return <div className="react-toast" role="status">{message}</div>;
}

export function Confetti({ burst }) {
  if (!burst) return null;
  const colors = ['#91b765', '#d3b47a', '#8cc5d0', '#e9ca77', '#a46c4b'];
  return <>{Array.from({ length: 34 }, (_, index) => <i key={`${burst}-${index}`} className="conf" style={{
    left: `${Math.random() * 100}vw`, background: colors[index % colors.length],
    animationDuration: `${1.4 + Math.random() * 1.1}s`, animationDelay: `${Math.random() * .25}s`,
    borderRadius: index % 3 === 0 ? '50%' : undefined,
  }} />)}</>;
}
