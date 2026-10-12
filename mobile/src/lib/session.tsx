import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { SESSION_KEY as KEY, authState } from './api';
import { resetTracking } from './gps';
import { loadServer } from './server-store';

/** Where each role lands after login. A role missing here is not supported by the app. */
export const HOME = { AUTHORITY: '/authority', DRIVER: '/driver', PASSENGER: '/passenger' } as const;
export type Role = keyof typeof HOME;
export type User = { id: string; name: string; email: string | null; phone: string | null; role: Role; institutionId: string };

type Session = {
  user: User | null;
  /** False until the stored session has been read, so the app never flashes the login screen. */
  ready: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async () => {
    authState.token = null;
    setUser(null);
    await resetTracking().catch(() => {}); // never keep sharing location for a signed-out account
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
  }, []);

  const signIn = useCallback(async (token: string, next: User) => {
    authState.token = token;
    setUser(next);
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token, user: next }));
  }, []);

  useEffect(() => {
    authState.onExpired = signOut;
    loadServer() // the saved server address must be applied before the first request
      .then(() => SecureStore.getItemAsync(KEY))
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { token: string; user: User };
        authState.token = saved.token;
        setUser(saved.user);
      })
      .catch(() => {}) // unreadable or corrupt: start signed out
      .finally(() => setReady(true));
  }, [signOut]);

  const value = useMemo(() => ({ user, ready, signIn, signOut }), [user, ready, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
