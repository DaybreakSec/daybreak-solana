import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionLabel from '../components/SectionLabel';
import SeverityBadge from '../components/SeverityBadge';
import ActionButton from '../components/ActionButton';
import { useToast } from '../components/Toast';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];

export default function History() {
  const toast = useToast();
  const navigate = useNavigate();
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    fetch('/api/audits')
      .then(r => r.json())
      .then(data => setAudits(data.audits || []))
      .catch(err => toast('Failed to load saved audits: ' + err.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  async function handleLoad(id) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/audits/${id}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      toast('Audit loaded', 'success');
      navigate('/audit');
    } catch (err) {
      toast('Failed to load audit: ' + err.message, 'error');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/audits/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setAudits(prev => prev.filter(a => a.id !== id));
      toast('Audit deleted', 'success');
    } catch (err) {
      toast('Failed to delete audit: ' + err.message, 'error');
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <SectionLabel>saved audits</SectionLabel>
        <h1
          className="font-display text-text-primary mt-1"
          style={{ fontSize: '28px', lineHeight: '1.15', fontWeight: 500 }}
        >
          history
        </h1>
      </div>

      {loading ? (
        <p className="font-mono text-text-tertiary" style={{ fontSize: '13px' }}>
          loading...
        </p>
      ) : audits.length === 0 ? (
        <div
          className="bg-bg-elevated"
          style={{
            borderRadius: 'var(--radius-xl)',
            border: '0.5px solid var(--color-border-default)',
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <p className="font-mono text-text-tertiary" style={{ fontSize: '14px' }}>
            no saved audits yet
          </p>
          <p className="font-mono text-text-tertiary mt-2" style={{ fontSize: '13px' }}>
            run an audit and save it from the export page
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {audits.map(audit => (
            <div
              key={audit.id}
              className="bg-bg-elevated"
              style={{
                borderRadius: 'var(--radius-lg)',
                border: '0.5px solid var(--color-border-default)',
                padding: '16px 20px',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: info */}
                <div className="min-w-0 flex-1">
                  <h3
                    className="font-display text-text-primary truncate"
                    style={{ fontSize: '17px', fontWeight: 500, lineHeight: '1.35' }}
                  >
                    {audit.name}
                  </h3>
                  <p
                    className="font-mono text-text-tertiary mt-1 truncate"
                    style={{ fontSize: '13px' }}
                  >
                    {audit.target || 'no target'}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span
                      className="font-mono text-text-tertiary"
                      style={{ fontSize: '12px' }}
                    >
                      {new Date(audit.savedAt).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </span>
                    {audit.phase && (
                      <span
                        className="font-mono text-text-tertiary"
                        style={{ fontSize: '12px' }}
                      >
                        {audit.phase}
                      </span>
                    )}
                    {/* Severity summary */}
                    {audit.findingsCount && (
                      <div className="flex items-center gap-1.5">
                        {SEVERITIES.map(sev => {
                          const count = audit.findingsCount[sev];
                          if (!count) return null;
                          return (
                            <span key={sev} className="flex items-center gap-1">
                              <SeverityBadge severity={sev} />
                              <span
                                className="font-mono text-text-secondary"
                                style={{ fontSize: '12px' }}
                              >
                                {count}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ActionButton
                    variant="primary"
                    onClick={() => handleLoad(audit.id)}
                    disabled={loadingId === audit.id}
                  >
                    {loadingId === audit.id ? 'loading...' : 'load'}
                  </ActionButton>
                  <ActionButton onClick={() => handleDelete(audit.id)}>
                    delete
                  </ActionButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
