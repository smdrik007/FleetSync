import { Camera, type CameraRef, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { FeatureCollection } from 'geojson';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { RoleScreen } from '@/components/role-screen';
import { Stepper } from '@/components/stepper';
import { type ApiError, api } from '@/lib/api';
import { STALE_MS, type Stop, milestoneIndex, parseRoute, timeAgo } from '@/lib/logic';
import { MIN_TOUCH, radius, useTheme } from '@/lib/theme';
import { openSocket } from '@/lib/ws';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const START_VIEW = { center: [89.52, 22.86] as [number, number], zoom: 10 };
const REFRESH_EVENTS = ['trip.started', 'trip.ended', 'vehicle.route_updated', 'vehicle.driver_assigned', 'vehicle.status_changed'];

type Vehicle = { id: string; vehicleNumber: string; selectable: boolean };
type Status = {
  id: string;
  vehicleNumber: string;
  plateNumber: string;
  assignedRoute: string | null;
  routeStops: Stop[];
  assignedDriver: { name: string; phone: string | null } | null;
  activeTrip: { id: string } | null;
  lastKnownPosition: { latitude: number | null; longitude: number | null; updatedAt: string } | null;
};
type Position = { latitude: number; longitude: number; at: number };

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export default function Passenger() {
  const t = useTheme();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());

  const selectedRef = useRef<string | null>(null);
  const socketRef = useRef<{ send: (p: object) => void } | null>(null);
  const camera = useRef<CameraRef>(null);
  const centeredFor = useRef<string | null>(null);

  const loadVehicles = useCallback(async () => {
    try {
      setVehicles(await api.get<Vehicle[]>('/passenger/vehicles'));
      setError('');
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  const loadStatus = useCallback(async (id: string) => {
    try {
      const s = await api.get<Status>(`/passenger/vehicles/${id}/status`);
      if (selectedRef.current !== id) return; // another vehicle was picked meanwhile
      const p = s.lastKnownPosition;
      setStatus(s);
      setError('');
      setPosition(
        p && p.latitude != null && p.longitude != null
          ? { latitude: p.latitude, longitude: p.longitude, at: new Date(p.updatedAt).getTime() }
          : null,
      );
    } catch (e) {
      if (selectedRef.current === id) setError((e as ApiError).message);
    }
  }, []);

  const select = (id: string) => {
    const previous = selectedRef.current;
    if (previous === id) return;
    if (previous) socketRef.current?.send({ action: 'unwatch_vehicle', vehicleId: previous });
    selectedRef.current = id;
    setSelectedId(id);
    setStatus(null);
    setPosition(null);
    setError('');
    socketRef.current?.send({ action: 'watch_vehicle', vehicleId: id });
    loadStatus(id);
  };

  useEffect(() => {
    loadVehicles();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      loadVehicles();
      if (selectedRef.current) loadStatus(selectedRef.current);
    });
    return () => sub.remove();
  }, [loadVehicles, loadStatus]);

  useEffect(() => {
    const socket = openSocket(
      (event, data) => {
        const id = selectedRef.current;
        if (!id || data?.vehicleId !== id) return;
        if (event === 'location.update') {
          setPosition({ latitude: data.latitude, longitude: data.longitude, at: Date.now() });
        } else if (REFRESH_EVENTS.includes(event)) {
          loadStatus(id);
        }
      },
      (up) => {
        setConnected(up);
        // A fresh connection has no subscriptions: watch again.
        if (up && selectedRef.current) socket.send({ action: 'watch_vehicle', vehicleId: selectedRef.current });
      },
    );
    socketRef.current = socket;
    return socket.close;
  }, [loadStatus]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Follow the bus: jump on the first fix for a vehicle, ease afterwards so the user's zoom is kept.
  useEffect(() => {
    if (!position || !selectedId) return;
    const center: [number, number] = [position.longitude, position.latitude];
    if (centeredFor.current !== selectedId) {
      centeredFor.current = selectedId;
      camera.current?.jumpTo({ center, zoom: 14 });
    } else {
      camera.current?.easeTo({ center, duration: 800 });
    }
  }, [position, selectedId]);

  // FR-PAS-04: the marker stays at the last position and turns amber once updates stop.
  const stale = !!position && now - position.at > STALE_MS;
  const onTrip = !!status?.activeTrip;
  const stopNames = status ? (status.routeStops.length ? status.routeStops.map((s) => s.name) : parseRoute(status.assignedRoute)) : [];

  const stopsGeo: FeatureCollection = status?.routeStops.length
    ? {
        type: 'FeatureCollection',
        features: status.routeStops.map((s) => ({
          type: 'Feature',
          properties: { name: s.name },
          geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
        })),
      }
    : empty;
  const lineGeo: FeatureCollection =
    status && status.routeStops.length > 1
      ? {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: status.routeStops.map((s) => [s.longitude, s.latitude]) },
          }],
        }
      : empty;
  const busGeo: FeatureCollection = position
    ? {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] } }],
      }
    : empty;

  const driver = status?.assignedDriver;

  return (
    <RoleScreen title="Track a vehicle">
      <View style={{ flex: 1, gap: 12 }}>
        {vehicles === null && !error ? <ActivityIndicator color={t.accent} /> : null}

        {vehicles ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
            {vehicles.map((v) => {
              const on = v.id === selectedId;
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !v.selectable }}
                  disabled={!v.selectable}
                  onPress={() => select(v.id)}
                  style={[
                    styles.chip,
                    { backgroundColor: on ? t.accent : t.surface, borderColor: on ? t.accent : t.border, opacity: v.selectable ? 1 : 0.45 },
                  ]}>
                  <Text style={{ color: on ? t.onAccent : t.text, fontSize: 16, fontWeight: '600' }}>{v.vehicleNumber}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {vehicles && vehicles.length === 0 ? (
          <Text style={{ color: t.textSecondary, fontSize: 16 }}>No vehicles are available at your institution.</Text>
        ) : null}

        <View style={[styles.map, { borderColor: t.border }]}>
          <Map style={{ flex: 1 }} mapStyle={MAP_STYLE}>
            <Camera ref={camera} initialViewState={START_VIEW} />
            <GeoJSONSource id="route" data={lineGeo}>
              <Layer id="route-line" type="line" paint={{ 'line-color': t.accent, 'line-width': 4 }} />
            </GeoJSONSource>
            <GeoJSONSource id="stops" data={stopsGeo}>
              <Layer
                id="stop-dots"
                type="circle"
                paint={{ 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': t.accent, 'circle-stroke-width': 2 }}
              />
            </GeoJSONSource>
            <GeoJSONSource id="bus" data={busGeo}>
              <Layer
                id="bus-dot"
                type="circle"
                paint={{
                  'circle-radius': 10,
                  'circle-color': stale ? t.amber : t.green,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 3,
                }}
              />
            </GeoJSONSource>
          </Map>
        </View>

        <ScrollView style={{ maxHeight: '48%', flexGrow: 0 }} contentContainerStyle={{ gap: 12 }}>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <View style={[styles.dot, { backgroundColor: connected ? t.green : t.amber }]} />
            <Text style={{ color: t.muted, fontSize: 13 }}>{connected ? 'Live updates connected' : 'Reconnecting'}</Text>
          </View>

          {error ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.red, fontSize: 15 }}>{error}</Text>
              <Button label="Retry" variant="secondary" onPress={() => (selectedRef.current ? loadStatus(selectedRef.current) : loadVehicles())} />
            </View>
          ) : null}

          {!selectedId && vehicles?.length ? (
            <Text style={{ color: t.textSecondary, fontSize: 16 }}>Pick a vehicle to follow it live on the map.</Text>
          ) : null}

          {selectedId && !status && !error ? <ActivityIndicator color={t.accent} /> : null}

          {status ? (
            <>
              <View accessibilityLiveRegion="polite">
                {position ? (
                  stale ? (
                    <Text style={{ color: t.amber, fontSize: 16, fontWeight: '700' }}>
                      Signal lost. Last updated {timeAgo(position.at, now)}
                    </Text>
                  ) : (
                    <Text style={{ color: t.green, fontSize: 16, fontWeight: '700' }}>Live</Text>
                  )
                ) : (
                  <Text style={{ color: t.textSecondary, fontSize: 16 }}>
                    {onTrip ? 'Waiting for the first location…' : 'This vehicle has not started its trip.'}
                  </Text>
                )}
              </View>

              <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>
                {status.vehicleNumber} · {status.plateNumber}
              </Text>
              {status.assignedRoute ? <Text style={{ color: t.muted, fontSize: 15 }}>{status.assignedRoute}</Text> : null}

              {stopNames.length ? <Stepper stops={stopNames} current={milestoneIndex(status.routeStops, position, onTrip)} /> : null}

              {driver ? (
                <View style={[styles.driver, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{driver.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 14 }}>{driver.phone ?? 'No phone on file'}</Text>
                  </View>
                  {driver.phone ? <Button label="Call" onPress={() => Linking.openURL(`tel:${driver.phone}`)} /> : null}
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    </RoleScreen>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: MIN_TOUCH - 8, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, justifyContent: 'center' },
  map: { flex: 1, minHeight: 200, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.lg, padding: 12 },
});
