import * as SecureStore from 'expo-secure-store';

import { DEFAULT_ORIGIN, normalizeServerUrl, server } from './api';

const KEY = 'fs_server';
let loaded: Promise<void> | null = null;

/** Applies a saved server address once. Safe to call from the headless GPS task as well as from screens. */
export function loadServer(): Promise<void> {
  loaded ??= SecureStore.getItemAsync(KEY)
    .then((saved) => {
      const origin = saved ? normalizeServerUrl(saved) : null;
      if (origin) server.origin = origin;
    })
    .catch(() => {}); // unreadable: keep the built-in address
  return loaded;
}

/** Throws a user-facing Error for an address the app will not talk to. */
export async function saveServer(input: string): Promise<string> {
  const origin = normalizeServerUrl(input);
  if (!origin) throw new Error('Enter an address like https://your-server.example.com (https is required).');
  await SecureStore.setItemAsync(KEY, origin);
  server.origin = origin;
  return origin;
}

export async function resetServer(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
  server.origin = DEFAULT_ORIGIN;
}
