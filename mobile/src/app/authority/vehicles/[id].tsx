import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Badge, Card, ErrorNote, Field, PickerField, Row, Screen, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { VEHICLE_STATUSES, fmtKm, fmtLitres, fmtMoney, statusLabel, statusTone } from '@/lib/authority-logic';
import { useFleetEvents } from '@/lib/fleet-socket';
import { timeAgo } from '@/lib/logic';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';


type Vehicle = {
  id: string; vehicleNumber: string; plateNumber: string; currentStatus: string; model: string | null; capacity: number | null;
  fuelEfficiencyKmpl: number | null; assignedRouteId: string | null; assignedRoute: string | null;
  assignedDriver: { id: string; name: string; phone: string | null } | null;
  lastKnownPosition: { updatedAt: string; speed: number | null; isStale: boolean } | null;
};
type Driver = { id: string; name: string; employmentStatus: string; currentVehicleNumber: string | null };
type RouteRow = { id: string; name: string };
type Trip = { id: string; startedAt: string; status: string; driver: { name: string }; distanceKm: number | null; estFuelLitres: number | null };

export default function VehicleDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: v, error, loading, reload } = useLoad(() => api.get<Vehicle>(`/fleet/vehicles/${id}`));
  const { data: trips, reload: reloadTrips } = useLoad(() => api.get<Trip[]>(`/fleet/trips?vehicleId=${id}`));
  const [editing, setEditing] = useState(false);
  const [fueling, setFueling] = useState(false);

  useFleetEvents((event, data) => {
    if (data?.vehicleId === id && event !== 'location.update') { reload(); reloadTrips(); }
  });

  return (
    <Screen
      title={v?.vehicleNumber ?? 'Vehicle'} subtitle={v?.plateNumber}
      right={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
      onRefresh={() => { reload(); reloadTrips(); }} refreshing={loading && !!v}>
      {!v && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}

      {v ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: t.text, fontSize: 16 }}>{v.model ?? 'No model'}{v.capacity ? ` · ${v.capacity} seats` : ''}</Text>
              <Badge label={statusLabel(v.currentStatus)} tone={statusTone(v.currentStatus)} />
            </View>
            <Row label="Driver" value={v.assignedDriver?.name ?? 'Unassigned'} />
            <Row label="Route" value={v.assignedRoute ?? 'On demand'} />
            <Row label="Fuel efficiency" value={v.fuelEfficiencyKmpl ? `${v.fuelEfficiencyKmpl} km/L` : undefined} />
            <Row
              label="Last position"
              value={v.lastKnownPosition ? `${timeAgo(Date.parse(v.lastKnownPosition.updatedAt))}${v.lastKnownPosition.isStale ? ' (stale)' : ''}` : 'None yet'} />
            {v.assignedDriver?.phone ? (
              <Button label={`Call ${v.assignedDriver.name}`} variant="secondary" onPress={() => Linking.openURL(`tel:${v.assignedDriver?.phone?.replace(/[^\d+]/g, '')}`)} />
            ) : null}
          </Card>

          {editing ? <EditAssignment v={v} onDone={() => { setEditing(false); reload(); }} /> : <Button label="Change status, driver or route" onPress={() => setEditing(true)} />}
          {fueling ? <FuelForm vehicleId={v.id} onDone={() => setFueling(false)} /> : <Button label="Log fuel" variant="secondary" onPress={() => setFueling(true)} />}

          <SectionTitle>Recent trips</SectionTitle>
          <Card>
            {!trips || trips.length === 0 ? <Text style={{ color: t.muted }}>No trips yet.</Text> : null}
            {(trips ?? []).slice(0, 5).map((tr) => (
              <Row
                key={tr.id}
                label={`${new Date(tr.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${tr.driver.name}`}
                value={tr.status === 'in_progress' ? 'Running' : `${fmtKm(tr.distanceKm)} · ${fmtLitres(tr.estFuelLitres)}`} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function EditAssignment({ v, onDone }: { v: Vehicle; onDone: () => void }) {
  const [status, setStatus] = useState(v.currentStatus);
  const [driverId, setDriverId] = useState(v.assignedDriver?.id ?? '');
  const [routeId, setRouteId] = useState(v.assignedRouteId ?? '');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Driver[]>('/fleet/drivers').then(setDrivers).catch((e) => setError(e.message));
    api.get<RouteRow[]>('/fleet/routes').then(setRoutes).catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.put(`/fleet/vehicles/${v.id}`, { currentStatus: status, assignedDriverId: driverId || null, assignedRouteId: routeId || null });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <PickerField label="Status" value={status} onChange={setStatus} options={VEHICLE_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
      <PickerField
        label="Driver" value={driverId} onChange={setDriverId} emptyLabel="Unassigned"
        options={drivers.filter((d) => d.employmentStatus === 'active' || d.id === v.assignedDriver?.id)
          .map((d) => ({ value: d.id, label: d.name, hint: d.currentVehicleNumber && d.id !== v.assignedDriver?.id ? `Now on ${d.currentVehicleNumber}: moves here` : undefined }))} />
      <PickerField label="Route" value={routeId} onChange={setRouteId} emptyLabel="None (on demand)" options={routes.map((r) => ({ value: r.id, label: r.name }))} />
      {error ? <ErrorNote message={error} /> : null}
      <Button label="Save changes" busy={busy} onPress={save} />
      <Button label="Cancel" variant="secondary" disabled={busy} onPress={onDone} />
    </Card>
  );
}

function FuelForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const [litres, setLitres] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/fleet/fuel', { vehicleId, volume: Number(litres), totalCost: Number(cost) });
      setSaved(`Logged ${litres} L for ${fmtMoney(Number(cost))}.`);
      setLitres('');
      setCost('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Field label="Litres" value={litres} onChangeText={setLitres} keyboardType="decimal-pad" placeholder="40" />
      <Field label="Total cost (৳)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="4480" />
      {error ? <ErrorNote message={error} /> : null}
      {saved ? <Text accessibilityLiveRegion="polite" style={{ fontSize: 15 }}>{saved}</Text> : null}
      <Button label="Save fuel log" busy={busy} disabled={!litres || !cost} onPress={save} />
      <Button label="Close" variant="secondary" disabled={busy} onPress={onDone} />
    </Card>
  );
}
