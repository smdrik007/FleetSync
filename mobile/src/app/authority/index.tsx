import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Badge, Card, ErrorNote, Kpi, Row, Screen, SectionTitle } from '@/components/ui';
import { statusLabel, fmtMoney } from '@/lib/authority-logic';
import { api } from '@/lib/api';
import { useFleet, useFleetEvents } from '@/lib/fleet-socket';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

type Summary = {
  totalVehicles: number;
  vehiclesByStatus: Record<string, number>;
  activeTrips: number;
  devices: Record<string, number> & { online: number };
  upcomingMaintenance: { id: string; vehicleNumber: string; description: string; serviceDate: string }[];
  fuelCost30d: number;
  licenseExpiring: { driverId: string; name: string; licenseExpiry: string }[];
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export default function Home() {
  const t = useTheme();
  const { connected } = useFleet();
  const { data: s, error, loading, reload } = useLoad(() => api.get<Summary>('/fleet/dashboard/summary'));

  // Trips and status changes are the events that move these numbers; wait a second so a burst reloads once.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useFleetEvents((event) => {
    if (event === 'trip.started' || event === 'trip.ended' || event === 'vehicle.status_changed') {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 1000);
    }
  });
  useEffect(() => {
    const id = setInterval(reload, 60000);
    return () => { clearInterval(id); clearTimeout(timer.current); };
  }, [reload]);

  const by = s?.vehiclesByStatus ?? {};
  return (
    <Screen
      title="Transport pool" subtitle={connected ? 'Live updates connected' : 'Reconnecting…'}
      onRefresh={reload} refreshing={loading && !!s}>
      {!s && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}

      {s ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Kpi label="Vehicles" value={String(s.totalVehicles)} foot={`${by.on_trip ?? 0} on trip · ${by.idle ?? 0} idle`} />
            <Kpi label="Active trips" value={String(s.activeTrips)} foot="Running now" />
            <Kpi label="Devices online" value={String(s.devices.online)} />
            <Kpi label="Fuel, 30 days" value={fmtMoney(s.fuelCost30d)} />
          </View>

          <SectionTitle>Fleet status</SectionTitle>
          <Card>
            {Object.entries(by).map(([k, n]) => (
              <Row key={k} label={statusLabel(k)} value={String(n)} />
            ))}
          </Card>

          <SectionTitle>Upcoming maintenance</SectionTitle>
          <Card>
            {s.upcomingMaintenance.length === 0 ? <Text style={{ color: t.muted }}>Nothing scheduled.</Text> : null}
            {s.upcomingMaintenance.map((m) => (
              <Row key={m.id} label={`${m.vehicleNumber} · ${m.description}`} value={day(m.serviceDate)} />
            ))}
          </Card>

          <SectionTitle>Licences expiring</SectionTitle>
          <Card>
            {s.licenseExpiring.length === 0 ? <Text style={{ color: t.muted }}>All licences are valid for 30+ days.</Text> : null}
            {s.licenseExpiring.map((d) => {
              const left = daysLeft(d.licenseExpiry);
              return (
                <View key={d.driverId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{d.name}</Text>
                  <Badge label={left < 0 ? `Expired ${-left}d ago` : `${left}d left`} tone={left < 0 ? 'red' : 'amber'} />
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
