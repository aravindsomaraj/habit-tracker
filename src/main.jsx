import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import '../assets/css/styles.css';
import './react.css';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
