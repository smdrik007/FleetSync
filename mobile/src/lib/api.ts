// Port of website/app.js Api: Bearer JWT and the { success, data, error: { code, message } } envelope.
export const DEFAULT_ORIGIN = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** The backend address. Baked in at build time; the user can override it in the app (see server-store.ts). */
export const server = { origin: DEFAULT_ORIGIN };

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** Accepts https://host[:port], or http:// only for this machine/LAN. Returns the cleaned origin, or null. */
export function normalizeServerUrl(input: string): string | null {
  const m = /^(https?):\/\/([a-z0-9.-]+)(:\d{1,5})?$/i.exec(input.trim().replace(/\/+$/, ''));
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (scheme === 'http' && !PRIVATE_HOST.test(host)) return null; // never send passwords over plain http across the internet
  return `${scheme}://${host}${m[3] ?? ''}`;
}

/** SecureStore key of the saved login; the headless GPS task reads the token from it. */
export const SESSION_KEY = 'fs_session';

/** Set by the session provider; kept here so request code never imports React. */
export const authState = { token: null as string | null, onExpired: () => {} };

export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server.origin}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authState.token ? { Authorization: `Bearer ${authState.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 'NETWORK');
  }
  const json = await res.json().catch(() => null); // non-JSON body (proxy error page)
  // An expired or invalid session sends the user back to login, but a wrong password is just an error.
  if (res.status === 401 && path !== '/auth/login') authState.onExpired();
  if (!res.ok || !json?.success) {
    throw new ApiError(json?.error?.message ?? `Request failed (${res.status})`, json?.error?.code, res.status);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
};
