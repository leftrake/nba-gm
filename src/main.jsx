import React from 'react';
import { createRoot } from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
// copied from country-flag-emoji-polyfill/dist — its exports map blocks deep imports
import flagsFontUrl from './assets/TwemojiCountryFlags.woff2?url';
import App from './App.jsx';
import './styles.css';

// Windows has no flag emoji glyphs — this registers a flags-only font
// ('Twemoji Country Flags', first in the CSS font stack) where needed.
// The font is bundled locally instead of using the package's default CDN URL.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagsFontUrl);

createRoot(document.getElementById('root')).render(<App />);
