import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';

import { Button } from '@/components/button';
import { Badge, Card, ErrorNote, Field, PickerField, Screen, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { useFleet, useFleetEvents } from '@/lib/fleet-socket';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Note = { id: string; title: string; message: string; isRead: boolean; createdAt: string };
type Inbox = { items: Note[]; unreadCount: number };
type UserRow = { id: string; name: string; roles: string[] };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Notifications() {
  const t = useTheme();
  const { refreshUnread } = useFleet();
  const { data, error, loading, reload } = useLoad(() => api.get<Inbox>('/fleet/notifications'));
  const [composing, setComposing] = useState(false);

  useFleetEvents((event) => { if (event === 'notification.new') reload(); });

  const open = async (n: Note) => {
    if (n.isRead) return;
    try {
      await api.post(`/fleet/notifications/${n.id}/read`);
      await reload();
      refreshUnread();
    } catch { /* leave it unread; the next refresh shows the truth */ }
  };
  const readAll = async () => {
    try {
      await api.post('/fleet/notifications/read-all');
      await reload();
      refreshUnread();
    } catch { /* same */ }
  };

  return (
    <Screen
      title="Notifications" subtitle={data ? `${data.unreadCount} unread` : undefined}
      right={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
      onRefresh={reload} refreshing={loading && !!data}>
      {composing ? <Compose onDone={() => setComposing(false)} /> : <Button label="Send a notification" onPress={() => setComposing(true)} />}
      {data && data.unreadCount > 0 ? <Button label="Mark all as read" variant="secondary" onPress={readAll} /> : null}

      <SectionTitle>Inbox</SectionTitle>
      {!data && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 ? <Text style={{ color: t.textSecondary, fontSize: 16 }}>No notifications.</Text> : null}
      {(data?.items ?? []).map((n) => (
        <Card key={n.id} onPress={() => open(n)} accessibilityLabel={`${n.title}${n.isRead ? '' : ', unread'}`}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: n.isRead ? '500' : '700' }}>{n.title}</Text>
          <Text style={{ color: t.textSecondary, fontSize: 14 }}>{n.message}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{when(n.createdAt)}</Text>
          {!n.isRead ? <Badge label="New" tone="accent" /> : null}
        </Card>
      ))}
    </Screen>
  );
}

function Compose({ onDone }: { onDone: () => void }) {
  const { data: users, error: loadError } = useLoad(() => api.get<UserRow[]>('/fleet/users'));
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/fleet/notifications', { userId, title: title.trim(), message: message.trim() });
      setSent('Sent.');
      setTitle('');
      setMessage('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <PickerField
        label="To" value={userId} onChange={setUserId}
        options={(users ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.roles.join(', ') }))} />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Route change tomorrow" />
      <Field label="Message" value={message} onChangeText={setMessage} multiline placeholder="Details…" />
      {loadError || error ? <ErrorNote message={loadError || error} /> : null}
      {sent ? <Text accessibilityLiveRegion="polite" style={{ fontSize: 15 }}>{sent}</Text> : null}
      <Button label="Send" busy={busy} disabled={!userId || !title.trim() || !message.trim()} onPress={send} />
      <Button label="Close" variant="secondary" disabled={busy} onPress={onDone} />
    </Card>
  );
}
