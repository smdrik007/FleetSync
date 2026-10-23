import { Camera, type CameraRef, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { type Href, router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Badge, Card, ErrorNote, Screen } from '@/components/ui';
import { type Pos, applyLocation, fromPositionRow, isStale, nearestPos, positionsToGeoJson } from '@/lib/authority-logic';
import { api } from '@/lib/api';
import { useFleet, useFleetEvents } from '@/lib/fleet-socket';
import { timeAgo } from '@/lib/logic';
import { radius, useTheme } from '@/lib/theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const START_VIEW = { center: [89.52, 22.86] as [number, number], zoom: 10 };

type Row = { vehicleId: string; vehicleNumber: string; lat: number; lng: number; speed: number | null; recordedAt: string };

export default function FleetMap() {
  const t = useTheme();
  const { connected } = useFleet();
  const camera = useRef<CameraRef>(null);
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = async () => {
    setError('');
    try {
      const rows = await api.get<Row[]>('/fleet/positions');
      const next = Object.fromEntries(rows.map((r) => [r.vehicleId, fromPositionRow(r)]));
      setPositions(next);
      const pts = Object.values(next);
      if (pts.length) {
        const lngs = pts.map((p) => p.lng);
        const lats = pts.map((p) => p.lat);
        // A single vehicle would give a zero-size box, so pad it a little.
        const pad = 0.005;
        camera.current?.fitBounds([Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad], { duration: 500 });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => { load(); }, []);

  // Staleness is time-based, so re-evaluate it even when no fix arrives.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  useFleetEvents((event, data) => {
    if (event === 'location.update') setPositions((p) => applyLocation(p, data));
    // A trip ending removes the vehicle's live position on the server.
    if (event === 'trip.ended') load();
  });

  const geo = useMemo(() => positionsToGeoJson(positions, now) as never, [positions, now]);
  const list = useMemo(() => Object.values(positions).sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber)), [positions]);
  const sel = selected ? positions[selected] : null;

  const focus = (p: Pos) => {
    setSelected(p.vehicleId);
    camera.current?.easeTo({ center: [p.lng, p.lat], zoom: 14, duration: 600 });
  };

  return (
    <Screen title="Live map" subtitle={connected ? `${list.length} vehicle${list.length === 1 ? '' : 's'} reporting` : 'Reconnecting…'} scroll={false}>
      <View style={[styles.map, { borderColor: t.border }]}>
        <Map
          style={{ flex: 1 }}
          mapStyle={MAP_STYLE}
          onPress={(e) => {
            const [lng, lat] = e.nativeEvent.lngLat as unknown as [number, number];
            const hit = nearestPos(positions, lat, lng, 800);
            setSelected(hit ? hit.vehicleId : null);
          }}>
          <Camera ref={camera} initialViewState={START_VIEW} />
          <GeoJSONSource id="fleet" data={geo}>
            <Layer
              id="fleet-dots"
              type="circle"
              paint={{
                'circle-radius': 10,
                'circle-color': ['case', ['get', 'stale'], t.amber, t.green],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        </Map>
        {!loaded ? <View style={styles.overlay}><ActivityIndicator color={t.accent} /></View> : null}
      </View>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {loaded && !error && list.length === 0 ? (
        <Text style={{ color: t.textSecondary, fontSize: 16 }}>No vehicle is sharing its location right now.</Text>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
        {list.map((p) => {
          const on = p.vehicleId === selected;
          return (
            <Pressable
              key={p.vehicleId} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => focus(p)}
              style={[styles.chip, { backgroundColor: on ? t.accent : t.surface, borderColor: on ? t.accent : t.border }]}>
              <Text style={{ color: on ? t.onAccent : t.text, fontSize: 15, fontWeight: '600' }}>{p.vehicleNumber}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {sel ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{sel.vehicleNumber}</Text>
            <Badge label={isStale(sel, now) ? 'Signal lost' : 'Live'} tone={isStale(sel, now) ? 'amber' : 'green'} />
          </View>
          <Text style={{ color: t.muted, fontSize: 14 }}>
            {sel.speed !== null ? `${Math.round(sel.speed * 3.6)} km/h · ` : ''}updated {timeAgo(sel.at, now)}
          </Text>
          <Button label="Open vehicle" variant="secondary" onPress={() => router.push(`/authority/vehicles/${sel.vehicleId}` as Href)} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 220, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center' },
});
