import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { router } from 'expo-router';

import { Button } from '@/components/button';
import { ServerAddress } from '@/components/server-address';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Shared frame for the signed-in screens: title, who is signed in, content, sign out. */
export function RoleScreen({ title, children, signOutDisabled }: { title: string; children?: ReactNode; signOutDisabled?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 15 }}>{user?.name}</Text>
      <View style={styles.body}>{children}</View>
      {user?.role !== 'AUTHORITY' ? (
        <View style={{ marginBottom: 12 }}>
          <Button label="Contact us" variant="secondary" onPress={() => router.push('/contact')} />
        </View>
      ) : null}
      <Button label="Sign out" variant="secondary" onPress={signOut} disabled={signOutDisabled} />
      <View style={{ marginTop: 12 }}>
        <ServerAddress onChanged={() => router.replace('/')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { flex: 1, paddingVertical: 24 },
});
