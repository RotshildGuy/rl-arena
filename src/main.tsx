import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// No StrictMode: its double-invoked effects would spawn two training workers.
createRoot(document.getElementById('root')!).render(<App />);
