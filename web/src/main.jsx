import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastHost } from './lib.jsx';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/alexandria/500.css';
import '@fontsource/alexandria/600.css';
import '@fontsource/alexandria/700.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <ToastHost>
        <App />
      </ToastHost>
    </HashRouter>
  </StrictMode>,
);
