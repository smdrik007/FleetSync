import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { DEFAULT_ORIGIN, server } from '@/lib/api';
import { resetServer, saveServer } from '@/lib/server-store';
import { MIN_TOUCH, radius, useTheme } from '@/lib/theme';

/** Shows which backend the app talks to and lets the user point it elsewhere (e.g. a new tunnel address). */
export function ServerAddress({ onChanged }: { onChanged: () => void }) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const host = server.origin.replace(/^https?:\/\//, '');

  const save = async () => {
    try {
      await saveServer(value);
      setEditing(false);
      setError('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reset = async () => {
    await resetServer();
    setEditing(false);
    setError('');
    onChanged();
  };

  if (!editing) {
    return (
      <View style={styles.row}>
        <Text style={{ color: t.muted, fontSize: 13, flexShrink: 1 }}>Server: {host}</Text>
        <Pressable accessibilityRole="button" onPress={() => { setValue(server.origin); setEditing(true); }} style={styles.link}>
          <Text style={{ color: t.accent, fontSize: 14, fontWeight: '600' }}>Change</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: t.textSecondary, fontSize: 14, fontWeight: '600' }}>Server address</Text>
      <TextInput
        accessibilityLabel="Server address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://your-server.example.com"
        placeholderTextColor={t.muted}
        value={value}
        onChangeText={setValue}
        style={[styles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }]}
      />
      {error ? <Text style={{ color: t.red, fontSize: 14 }}>{error}</Text> : null}
      <Button label="Save address" onPress={save} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} /></View>
        {server.origin !== DEFAULT_ORIGIN ? <View style={{ flex: 1 }}><Button label="Use default" variant="secondary" onPress={reset} /></View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  link: { minHeight: MIN_TOUCH - 8, justifyContent: 'center', paddingLeft: 8 },
  input: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 16, fontSize: 16 },
});
