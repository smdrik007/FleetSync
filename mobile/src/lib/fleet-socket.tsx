import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api } from './api';
import { openSocket } from './ws';

type Handler = (event: string, data: any) => void;
type Ctx = {
  connected: boolean;
  /** Receive every socket event; returns the unsubscribe function. */
  subscribe: (fn: Handler) => () => void;
  /** Unread notifications for the More tab badge. */
  unread: number;
  refreshUnread: () => Promise<void>;
};

const FleetCtx = createContext<Ctx | null>(null);

/** One WebSocket for all authority tabs. Authorities are in the institution room, so every fleet event arrives unasked. */
export function FleetSocketProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Set<Handler>());
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(async () => {
    try {
      const r = await api.get<{ unreadCount: number }>('/fleet/notifications?unread=1');
      setUnread(r.unreadCount);
    } catch { /* the badge just stays as it was */ }
  }, []);

  useEffect(() => {
    refreshUnread();
    const socket = openSocket((event, data) => {
      if (event === 'notification.new') refreshUnread();
      handlers.current.forEach((h) => h(event, data));
    }, setConnected);
    return socket.close;
  }, [refreshUnread]);

  const subscribe = useCallback((fn: Handler) => {
    handlers.current.add(fn);
    return () => { handlers.current.delete(fn); };
  }, []);

  const value = useMemo(() => ({ connected, subscribe, unread, refreshUnread }), [connected, subscribe, unread, refreshUnread]);
  return <FleetCtx.Provider value={value}>{children}</FleetCtx.Provider>;
}

export function useFleet(): Ctx {
  const c = useContext(FleetCtx);
  if (!c) throw new Error('useFleet must be used inside FleetSocketProvider');
  return c;
}

/** Run `fn` for every socket event while the screen is mounted (always sees the latest closure). */
export function useFleetEvents(fn: Handler) {
  const { subscribe } = useFleet();
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => subscribe((e, d) => latest.current(e, d)), [subscribe]);
}
