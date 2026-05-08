import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Route guard hook. Fetches a state file and redirects if it's missing.
 * Returns { loading, data } where data is the parsed JSON (or null while loading).
 */
export function useRequireState(stateFile, redirectTo = '/') {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/state/${stateFile}`)
      .then(r => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(json => {
        if (!active) return;
        if (!json || (typeof json === 'object' && Object.keys(json).length === 0)) {
          navigate(redirectTo, { replace: true });
        } else {
          setData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) navigate(redirectTo, { replace: true });
      });
    return () => { active = false; };
  }, [stateFile, redirectTo, navigate]);

  return { loading, data };
}
