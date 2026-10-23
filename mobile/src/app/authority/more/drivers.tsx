import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Badge, Card, ErrorNote, Field, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { matches, statusLabel } from '@/lib/authority-logic';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Driver = {
  id: string; name: string; phone: string | null; email: string | null; employmentStatus: string;
  currentVehicleNumber: string | null; licenseNumber: string | null; licenseExpiry: string | null;
};

const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export default function Drivers() {
  const t = useTheme();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => api.get<Driver[]>('/fleet/drivers'));
  const rows = useMemo(() => (data ?? []).filter((d) => matches(q, d.name, d.phone, d.email, d.currentVehicleNumber)), [data, q]);

  return (
    <Screen
      title="Drivers" subtitle={data ? `${data.length} in your pool` : undefined}
      right={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
      onRefresh={reload} refreshing={loading && !!data}>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, phone or vehicle" autoCapitalize="none" autoCorrect={false} />
      {!data && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {data && rows.length === 0 ? <Text style={{ color: t.textSecondary, fontSize: 16 }}>No drivers match.</Text> : null}
      {rows.map((d) => {
        const left = d.licenseExpiry ? daysLeft(d.licenseExpiry) : null;
        return (
          <Card key={d.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flex: 1 }}>{d.name}</Text>
              <Badge label={statusLabel(d.employmentStatus)} tone={d.employmentStatus === 'active' ? 'green' : 'muted'} />
            </View>
            <Text style={{ color: t.muted, fontSize: 14 }}>{d.currentVehicleNumber ? `Driving ${d.currentVehicleNumber}` : 'No vehicle'}</Text>
            {left !== null && left <= 30 ? <Badge label={left < 0 ? `Licence expired ${-left}d ago` : `Licence: ${left}d left`} tone={left < 0 ? 'red' : 'amber'} /> : null}
            {d.phone ? <Button label={`Call ${d.phone}`} variant="secondary" onPress={() => Linking.openURL(`tel:${d.phone?.replace(/[^\d+]/g, '')}`)} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
