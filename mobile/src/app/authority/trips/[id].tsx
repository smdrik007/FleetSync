import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/button';
import { Badge, Card, ErrorNote, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtKm, fmtLitres, fmtMoney, statusLabel } from '@/lib/authority-logic';
import { formatTripSummary } from '@/lib/logic';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

import { type TripRow, when } from './index';

type Detail = TripRow & { pointCount: number; durationMinutes: number | null };

export default function TripDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: tr, error, loading, reload } = useLoad(() => api.get<Detail>(`/fleet/trips/${id}`));

  return (
    <Screen
      title={tr?.vehicle.vehicleNumber ?? 'Trip'} subtitle={tr ? when(tr.startedAt) : undefined}
      right={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
      onRefresh={reload} refreshing={loading && !!tr}>
      {!tr && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {tr ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Row label="Status" value={<Badge label={statusLabel(tr.status)} tone={tr.status === 'in_progress' ? 'green' : 'muted'} />} />
          </View>
          <Row label="Driver" value={tr.driver.name} />
          <Row label="Route" value={tr.route?.name ?? 'On demand'} />
          <Row label="Started" value={when(tr.startedAt)} />
          <Row label="Ended" value={tr.endedAt ? when(tr.endedAt) : 'In progress'} />
          <Row label="Duration" value={tr.durationMinutes === null ? undefined : formatTripSummary({ distanceKm: null, durationMinutes: tr.durationMinutes })} />
          <Row label="Distance" value={fmtKm(tr.distanceKm, 2)} />
          <Row label="Est. fuel used" value={tr.estFuelLitres === null ? 'Set the vehicle’s km/L' : fmtLitres(tr.estFuelLitres)} />
          <Row label="Est. fuel cost" value={fmtMoney(tr.estFuelCost)} />
          <Row label="GPS points" value={String(tr.pointCount)} />
        </Card>
      ) : null}
    </Screen>
  );
}
