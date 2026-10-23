import { type Href, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Card, ErrorNote, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtKm, fmtLitres, fmtMoney, statusLabel } from '@/lib/authority-logic';
import { useFleetEvents } from '@/lib/fleet-socket';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export type TripRow = {
  id: string; status: string; startedAt: string; endedAt: string | null;
  vehicle: { id: string; vehicleNumber: string }; driver: { id: string; name: string }; route: { id: string; name: string } | null;
  distanceKm: number | null; estFuelLitres: number | null; estFuelCost: number | null;
};

const FILTERS = [['', 'All'], ['in_progress', 'Running'], ['completed', 'Completed']] as const;

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Trips() {
  const t = useTheme();
  const [filter, setFilter] = useState<string>('');
  const { data, error, loading, reload } = useLoad(() => api.get<TripRow[]>('/fleet/trips'));

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFleetEvents((event) => {
    if (event === 'trip.started' || event === 'trip.ended') {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 800);
    }
  });

  const rows = useMemo(() => (data ?? []).filter((r) => !filter || r.status === filter), [data, filter]);

  return (
    <Screen title="Trips" subtitle="Newest first" onRefresh={reload} refreshing={loading && !!data}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
        {FILTERS.map(([key, label]) => {
          const on = filter === key;
          return (
            <Pressable
              key={key || 'all'} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFilter(key)}
              style={{ minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: on ? t.accent : t.surface, borderColor: on ? t.accent : t.border }}>
              <Text style={{ color: on ? t.onAccent : t.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {!data && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {data && rows.length === 0 ? <Text style={{ color: t.textSecondary, fontSize: 16 }}>No trips yet.</Text> : null}
      {rows.map((r) => (
        <Card key={r.id} onPress={() => router.push(`/authority/trips/${r.id}` as Href)} accessibilityLabel={`${r.vehicle.vehicleNumber}, ${when(r.startedAt)}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{r.vehicle.vehicleNumber}</Text>
            <Badge label={statusLabel(r.status)} tone={r.status === 'in_progress' ? 'green' : 'muted'} />
          </View>
          <Text style={{ color: t.muted, fontSize: 14 }}>{when(r.startedAt)} · {r.driver.name}</Text>
          <Text style={{ color: t.textSecondary, fontSize: 14 }}>
            {r.status === 'in_progress' ? 'Running now' : `${fmtKm(r.distanceKm)} · ${fmtLitres(r.estFuelLitres)} · ${fmtMoney(r.estFuelCost)}`}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
