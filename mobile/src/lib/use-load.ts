import { useCallback, useEffect, useRef, useState } from 'react';

/** Load once on mount, expose `reload()` for pull-to-refresh and live events. A failed reload keeps the old data. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  latest.current = load;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await latest.current();
      if (alive.current) { setData(d); setError(''); }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => { alive.current = false; };
  }, [reload]);

  return { data, error, loading, reload, setData };
}
