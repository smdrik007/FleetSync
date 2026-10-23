import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { type ApiError, api } from '@/lib/api';
import { MIN_TOUCH, radius, useTheme } from '@/lib/theme';

type Contact = { name: string; contactPhone: string | null; contactEmail: string | null; contactAddress: string | null };

/** Contact details of the signed-in user's own institution, set by its authority in the web console. */
export default function ContactUs() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setContact(await api.get<Contact>('/contact'));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (url: string) => Linking.openURL(url).catch(() => setError('This phone cannot open that link.'));

  const rows: { label: string; value: string | null; url?: string }[] = contact
    ? [
        { label: 'Phone', value: contact.contactPhone, url: contact.contactPhone ? `tel:${contact.contactPhone.replace(/[^\d+]/g, '')}` : undefined },
        { label: 'Email', value: contact.contactEmail, url: contact.contactEmail ? `mailto:${contact.contactEmail}` : undefined },
        { label: 'Address', value: contact.contactAddress },
      ]
    : [];
  const hasAny = rows.some((r) => r.value);

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>Contact us</Text>
      {contact ? <Text style={{ color: t.muted, fontSize: 15 }}>{contact.name}</Text> : null}

      <View style={styles.body}>
        {!contact && !error ? <ActivityIndicator color={t.accent} /> : null}

        {error ? (
          <View style={{ gap: 12 }}>
            <Text accessibilityLiveRegion="polite" style={{ color: t.red, fontSize: 16 }}>{error}</Text>
            <Button label="Retry" variant="secondary" onPress={load} />
          </View>
        ) : null}

        {contact && !hasAny ? (
          <Text style={{ color: t.textSecondary, fontSize: 17 }}>Your transport office has not added contact details yet.</Text>
        ) : null}

        {contact && hasAny ? (
          <View style={{ gap: 12 }}>
            {rows.filter((r) => r.value).map((r) => {
              const content = (
                <>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{r.label}</Text>
                  <Text style={{ color: r.url ? t.accent : t.text, fontSize: 18, fontWeight: '600' }}>{r.value}</Text>
                </>
              );
              const style = [styles.card, { backgroundColor: t.surface, borderColor: t.border }];
              return r.url ? (
                <Pressable key={r.label} accessibilityRole="link" accessibilityLabel={`${r.label}: ${r.value}`} onPress={() => open(r.url as string)} style={style}>
                  {content}
                </Pressable>
              ) : (
                <View key={r.label} style={style}>{content}</View>
              );
            })}
          </View>
        ) : null}
      </View>

      <Button label="Back" variant="secondary" onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { flex: 1, paddingVertical: 24 },
  card: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, padding: 16, gap: 4, justifyContent: 'center' },
});
