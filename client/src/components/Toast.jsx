import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const ToastContext = createContext(null);

const TYPE_STYLES = {
  error: {
    border: 'rgba(232, 90, 90, 0.5)',
    bg: 'rgba(232, 90, 90, 0.08)',
    color: 'var(--color-dawn-coral)',
  },
  success: {
    border: 'rgba(245, 215, 142, 0.5)',
    bg: 'rgba(245, 215, 142, 0.08)',
    color: 'var(--color-dawn-gold)',
  },
  info: {
    border: 'rgba(245, 239, 230, 0.2)',
    bg: 'rgba(245, 239, 230, 0.05)',
    color: 'var(--color-text-secondary)',
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const addToast = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '400px',
          }}
        >
          {toasts.map(toast => {
            const s = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
            return (
              <div
                key={toast.id}
                role="alert"
                className="font-mono"
                style={{
                  fontSize: '13px',
                  lineHeight: '1.5',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-lg)',
                  border: `0.5px solid ${s.border}`,
                  background: s.bg,
                  color: s.color,
                  backdropFilter: 'blur(8px)',
                  cursor: 'pointer',
                  animation: 'toast-in 200ms ease-out',
                }}
                onClick={() => removeToast(toast.id)}
              >
                {toast.message}
              </div>
            );
          })}
          <style>{`
            @keyframes toast-in {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
