import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import AppFrame from './components/AppFrame';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import Setup from './pages/Setup';
import Scope from './pages/Scope';
import Audit from './pages/Audit';
import Findings from './pages/Findings';
import Export from './pages/Export';

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' },
};

function AnimatedRoutes({ appStatus, onStatusChange }) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} {...pageTransition}>
        <Routes location={location}>
          <Route path="/" element={<ErrorBoundary><Setup /></ErrorBoundary>} />
          <Route path="/scope" element={<ErrorBoundary><Scope /></ErrorBoundary>} />
          <Route path="/audit" element={<ErrorBoundary><Audit onStatusChange={onStatusChange} /></ErrorBoundary>} />
          <Route path="/findings" element={<ErrorBoundary><Findings onStatusChange={onStatusChange} /></ErrorBoundary>} />
          <Route path="/export" element={<ErrorBoundary><Export /></ErrorBoundary>} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  const [appStatus, setAppStatus] = useState('idle');

  // poll progress to determine global status
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch('/api/state/progress');
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (data.phase === 'done' || data.phase === 'done-with-errors' || data.phase === 'triage-complete') {
          setAppStatus('complete');
        } else if (data.phase === 'agents' || data.phase === 'prescan' || data.phase === 'scanning' || data.phase === 'validating') {
          setAppStatus('scanning');
        } else if (data.phase === 'dedup') {
          setAppStatus('triage');
        } else {
          setAppStatus('idle');
        }
      } catch (err) {
        console.warn('Progress poll failed:', err.message);
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return (
    <BrowserRouter>
      <ToastProvider>
        <AppFrame status={appStatus}>
          <AnimatedRoutes appStatus={appStatus} onStatusChange={setAppStatus} />
        </AppFrame>
      </ToastProvider>
    </BrowserRouter>
  );
}
