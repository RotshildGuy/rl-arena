import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { startAuth } from './ui/auth';
import './ui/styles.css';

// Before the first render: the session Firebase already has is what decides
// whether anybody sees the sign-in screen at all, and asking early means a
// returning visitor never sees it flash.
startAuth();

// No StrictMode: its double-invoked effects would spawn two training workers.
createRoot(document.getElementById('root')!).render(<App />);
