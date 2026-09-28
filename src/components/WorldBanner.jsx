import { DecorativeShapes } from './DecorativeShapes.jsx';

export function WorldBanner({ title = 'One small step. A little more progress.', subtitle = 'Build habits. Find your rhythm. Keep exploring.' }) {
  return <section className="world-banner" aria-label="Your habit journal">
    <div className="world-copy"><span className="eyebrow">YOUR EVERYDAY ADVENTURE</span><h1>{title}</h1><p>{subtitle}</p></div>
    <DecorativeShapes />
  </section>;
}

export function Brand() {
  return <div className="logo"><span className="journal-mark" aria-hidden="true">H</span><span>Habit Tracker<small>THE EVERYDAY JOURNAL</small></span></div>;
}
