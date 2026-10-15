import { authState, server } from './api.ts'; // explicit extension so node --test can load this file

/** Read on every connect, so a server address changed in the app applies to the next reconnect. */
const wsUrl = () => `${server.origin.replace(/^http/, 'ws')}/ws`;

export type Socket = { send: (payload: object) => void; close: () => void };

/** Port of website/app.js WsManager: Bearer token in the query string, reconnect with backoff 1s → 15s. */
export function openSocket(onEvent: (event: string, data: any) => void, onStatus: (connected: boolean) => void): Socket {
  let ws: WebSocket | null = null;
  let delay = 1000;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed || !authState.token) return;
    ws = new WebSocket(`${wsUrl()}?token=${authState.token}`);
    ws.onopen = () => {
      delay = 1000;
      onStatus(true);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        onEvent(msg.event, msg.data);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      ws = null;
      onStatus(false);
      if (closed) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  connect();

  return {
    send: (payload) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); },
    close: () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
