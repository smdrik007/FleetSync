import { type Href, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Badge, Card, ErrorNote, Field, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { matches, statusLabel, statusTone } from '@/lib/authority-logic';
import { useFleetEvents } from '@/lib/fleet-socket';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export type VehicleRow = {
  id: string;
  vehicleNumber: string;
  plateNumber: string;
  currentStatus: string;
  model: string | null;
  capacity: number | null;
  assignedRoute: string | null;
  assignedDriver: { id: string; name: string; phone: string | null } | null;
};

export default function Vehicles() {
  const t = useTheme();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => api.get<VehicleRow[]>('/fleet/vehicles'));

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFleetEvents((event) => {
    if (event.startsWith('vehicle.') || event === 'trip.started' || event === 'trip.ended') {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 800);
    }
  });

  const rows = useMemo(() => (data ?? []).filter((v) => matches(q, v.vehicleNumber, v.plateNumber, v.assignedDriver?.name, v.assignedRoute)), [data, q]);

  return (
    <Screen title="Vehicles" subtitle={data ? `${data.length} in your pool` : undefined} onRefresh={reload} refreshing={loading && !!data}>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Number, plate, driver or route" autoCapitalize="none" autoCorrect={false} />
      {!data && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {data && rows.length === 0 ? <Text style={{ color: t.textSecondary, fontSize: 16 }}>No vehicles match.</Text> : null}
      {rows.map((v) => (
        <Card key={v.id} onPress={() => router.push(`/authority/vehicles/${v.id}` as Href)} accessibilityLabel={`${v.vehicleNumber}, ${statusLabel(v.currentStatus)}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{v.vehicleNumber}</Text>
            <Badge label={statusLabel(v.currentStatus)} tone={statusTone(v.currentStatus)} />
          </View>
          <Text style={{ color: t.muted, fontSize: 14 }}>{[v.plateNumber, v.model].filter(Boolean).join(' · ')}</Text>
          <Text style={{ color: t.textSecondary, fontSize: 14 }}>
            {v.assignedDriver ? v.assignedDriver.name : 'No driver'} · {v.assignedRoute ?? 'On demand'}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
