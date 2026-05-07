import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import AppFrame from './components/AppFrame';
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
          <Route path="/" element={<Setup />} />
          <Route path="/scope" element={<Scope />} />
          <Route path="/audit" element={<Audit onStatusChange={onStatusChange} />} />
          <Route path="/findings" element={<Findings onStatusChange={onStatusChange} />} />
          <Route path="/export" element={<Export />} />
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
        if (data.phase === 'done' || data.phase === 'triage-complete') {
          setAppStatus('complete');
        } else if (data.phase === 'agents' || data.phase === 'prescan') {
          setAppStatus('scanning');
        } else if (data.phase === 'dedup') {
          setAppStatus('triage');
        } else {
          setAppStatus('idle');
        }
      } catch {
        // ignore polling errors
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return (
    <BrowserRouter>
      <AppFrame status={appStatus}>
        <AnimatedRoutes appStatus={appStatus} onStatusChange={setAppStatus} />
      </AppFrame>
    </BrowserRouter>
  );
}
