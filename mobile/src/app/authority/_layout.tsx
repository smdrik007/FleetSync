import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { FleetSocketProvider, useFleet } from '@/lib/fleet-socket';
import { useTheme } from '@/lib/theme';

function AuthorityTabs() {
  const t = useTheme();
  const { unread } = useFleet();
  // Plain text glyphs keep the tab bar free of an icon-font dependency.
  const tab = (title: string, glyph: string, extra: object = {}) => ({
    title,
    tabBarIcon: ({ color }: { color: string }) => <Text style={{ color, fontSize: 20 }}>{glyph}</Text>,
    ...extra,
  });
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
      }}>
      <Tabs.Screen name="index" options={tab('Home', '⌂')} />
      <Tabs.Screen name="map" options={tab('Map', '◎')} />
      <Tabs.Screen name="vehicles" options={tab('Vehicles', '▣')} />
      <Tabs.Screen name="trips" options={tab('Trips', '➜')} />
      <Tabs.Screen name="more" options={tab('More', '☰', unread ? { tabBarBadge: unread } : {})} />
    </Tabs>
  );
}

export default function AuthorityLayout() {
  return (
    <FleetSocketProvider>
      <AuthorityTabs />
    </FleetSocketProvider>
  );
}
