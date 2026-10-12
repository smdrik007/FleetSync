import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ServerAddress } from '@/components/server-address';
import { type ApiError, api } from '@/lib/api';
import { HOME, type User, useSession } from '@/lib/session';
import { MIN_TOUCH, radius, useTheme } from '@/lib/theme';

type Institution = { id: string; name: string };

export default function Login() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();

  const [institutions, setInstitutions] = useState<Institution[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Institution | null>(null);
  const [filter, setFilter] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadInstitutions = () => {
    setLoadError('');
    setInstitutions(null);
    api.get<Institution[]>('/institutions').then(setInstitutions).catch((e: ApiError) => setLoadError(e.message));
  };
  useEffect(loadInstitutions, []);

  const needle = filter.trim().toLowerCase();
  const matches = (institutions ?? []).filter((i) => i.name.toLowerCase().includes(needle));

  const submit = async () => {
    if (!selected) return setError('Select your institution.');
    if (!identifier.trim()) return setError('Enter your email or phone number.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError('');
    try {
      const { token, user } = await api.post<{ token: string; user: User }>('/auth/login', {
        institutionId: selected.id,
        email: identifier.trim(),
        password,
      });
      if (!(user.role in HOME)) {
        setError('This account type is not supported in the app. Use the web console.');
        return;
      }
      await signIn(token, user);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>FleetSync</Text>
        <Text style={{ color: t.muted, fontSize: 16 }}>Select your institution, then enter your credentials.</Text>

        {selected ? (
          <View style={[styles.row, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.rowText, { color: t.text }]}>{selected.name}</Text>
            <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.change}>
              <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.group}>
            <Text style={[styles.label, { color: t.textSecondary }]}>Institution</Text>
            <TextInput
              accessibilityLabel="Search institutions"
              placeholder="Search institutions"
              placeholderTextColor={t.muted}
              value={filter}
              onChangeText={setFilter}
              style={input}
            />
            {loadError ? (
              <>
                <Text style={{ color: t.red, fontSize: 15 }}>{loadError}</Text>
                <Button label="Retry" variant="secondary" onPress={loadInstitutions} />
              </>
            ) : institutions === null ? (
              <ActivityIndicator color={t.accent} />
            ) : matches.length === 0 ? (
              <Text style={{ color: t.muted, fontSize: 15 }}>No institutions match.</Text>
            ) : (
              matches.map((i) => (
                <Pressable
                  key={i.id}
                  accessibilityRole="button"
                  onPress={() => setSelected(i)}
                  style={[styles.row, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <Text style={[styles.rowText, { color: t.text }]}>{i.name}</Text>
                </Pressable>
              ))
            )}
          </View>
        )}

        {selected && (
          <View style={styles.group}>
            <Text style={[styles.label, { color: t.textSecondary }]}>Email or phone number</Text>
            <TextInput
              accessibilityLabel="Email or phone number"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={identifier}
              onChangeText={setIdentifier}
              style={input}
            />
            <Text style={[styles.label, { color: t.textSecondary }]}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              secureTextEntry
              autoCapitalize="none"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              style={input}
            />
            {error ? <Text accessibilityLiveRegion="polite" style={{ color: t.red, fontSize: 15 }}>{error}</Text> : null}
            <Button label="Sign in" onPress={submit} busy={busy} />
          </View>
        )}

        <ServerAddress onChanged={() => { setSelected(null); setError(''); loadInstitutions(); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 32, fontWeight: '800' },
  group: { gap: 12 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 16, fontSize: 17 },
  row: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: { fontSize: 17, fontWeight: '500', flexShrink: 1 },
  change: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingLeft: 16 },
});
