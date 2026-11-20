import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Fit-to-screen on PCs: the app is designed at 1536px wide and scaled to the real window width,
// so a 1280 laptop, a 1920 monitor and a 4K TV all show the same layout, just bigger or smaller.
// Phones and small tablets (760px or less) keep their own stacked layout (no scaling).
const DESIGN_WIDTH = 1536;
function fit() {
  const w = window.innerWidth;
  const z = w <= 760 ? 1 : Math.min(2.2, Math.max(0.78, w / DESIGN_WIDTH));
  document.documentElement.style.setProperty('--fit', z.toFixed(4));
}
fit();
window.addEventListener('resize', fit);

createRoot(document.getElementById('root')).render(<App />);
