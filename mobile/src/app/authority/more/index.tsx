import { router } from 'expo-router';
import { Text } from 'react-native';

import { Button } from '@/components/button';
import { ServerAddress } from '@/components/server-address';
import { Badge, Card, Screen } from '@/components/ui';
import { useFleet } from '@/lib/fleet-socket';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export default function More() {
  const t = useTheme();
  const { user, signOut } = useSession();
  const { unread } = useFleet();

  return (
    <Screen title="More" subtitle={user?.name}>
      <Card onPress={() => router.push('/authority/more/notifications')} accessibilityLabel="Notifications">
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>Notifications</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>Inbox and sending messages to drivers and passengers</Text>
        {unread ? <Badge label={`${unread} unread`} tone="accent" /> : null}
      </Card>
      <Card onPress={() => router.push('/authority/more/drivers')} accessibilityLabel="Drivers">
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>Drivers</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>Phone numbers, licences and current vehicle</Text>
      </Card>
      <Text style={{ color: t.muted, fontSize: 13 }}>Costs, routes, stops, devices and settings are in the web console.</Text>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
      <ServerAddress onChanged={() => router.replace('/')} />
    </Screen>
  );
}
