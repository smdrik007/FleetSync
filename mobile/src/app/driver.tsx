import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { RoleScreen } from '@/components/role-screen';
import { Stepper } from '@/components/stepper';
import { type ApiError, api } from '@/lib/api';
import { endTrip, ensurePermissions, getLive, readTrip, startSharing, subscribeLive, syncTracking } from '@/lib/gps';
import { formatElapsed, parseRoute } from '@/lib/logic';
import { openSocket } from '@/lib/ws';
import { radius, useTheme } from '@/lib/theme';

type Stop = { name: string; latitude: number; longitude: number };
type Assignment = {
  assigned: boolean;
  driverId: string;
  vehicle: {
    id: string;
    vehicleNumber: string;
    plateNumber: string;
    model: string | null;
    capacity: number | null;
    assignedRoute: string | null;
    routeStops: Stop[];
  } | null;
  activeTrip: { id: string; startedAt: string } | null;
};

function PulseDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, opacity }} />;
}

export default function Driver() {
  const t = useTheme();
  const live = useSyncExternalStore(subscribeLive, getLive);

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loadError, setLoadError] = useState('');
  const [trackError, setTrackError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const assignmentRef = useRef<Assignment | null>(null);

  const refresh = useCallback(async () => {
    try {
      const a = await api.get<Assignment>('/driver/me/assignment');
      assignmentRef.current = a;
      setAssignment(a);
      setLoadError('');
      try {
        await syncTracking(a.activeTrip?.id ?? null);
        setTrackError('');
      } catch (e) {
        setTrackError((e as Error).message);
      }
      setEnding(!!(await readTrip())?.ending);
    } catch (e) {
      setLoadError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  // FR-DRV-04: reassignment and route changes arrive on the institution channel, filtered by this driver/vehicle.
  useEffect(() => {
    const socket = openSocket((event, data) => {
      const me = assignmentRef.current;
      if (event === 'vehicle.driver_assigned' && me && (data.newDriver?.id === me.driverId || data.previousDriverId === me.driverId)) {
        setNotice(data.newDriver?.id === me.driverId
          ? 'You have been assigned to a vehicle. Your assignment below is up to date.'
          : 'Your vehicle assignment was changed by the transport authority.');
        refresh();
      }
      if (event === 'vehicle.route_updated' && me?.vehicle && data.vehicleId === me.vehicle.id) {
        setNotice('Your route was updated by the transport authority.');
        refresh();
      }
    }, setConnected, 'driver');
    return socket.close;
  }, [refresh]);

  // A sharing problem (Location switched off, permission revoked) often fixes itself outside the app, and
  // pulling down the quick settings does not change app state, so look again until it clears.
  useEffect(() => {
    if (!trackError) return;
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [trackError, refresh]);

  const onTrip = !!assignment?.activeTrip;
  useEffect(() => {
    if (!onTrip) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [onTrip]);

  const start = async () => {
    setBusy(true);
    setActionError('');
    try {
      await ensurePermissions(); // before creating a server trip we could not track
      const trip = await api.post<{ tripId: string }>('/driver/trips/start');
      await startSharing(trip.tripId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const end = async () => {
    const tripId = assignment?.activeTrip?.id;
    if (!tripId) return;
    setBusy(true);
    setActionError('');
    try {
      await endTrip(tripId);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const confirmEnd = () =>
    Alert.alert('End this trip?', 'Location sharing stops and passengers will no longer see the vehicle.', [
      { text: 'Keep driving', style: 'cancel' },
      { text: 'End trip', style: 'destructive', onPress: end },
    ]);

  const v = assignment?.vehicle;
  const stops = v ? (v.routeStops.length ? v.routeStops.map((s) => s.name) : parseRoute(v.assignedRoute)) : [];
  const sharing = onTrip && !ending && !trackError;
  const fix = live.lastFix;

  return (
    <RoleScreen title="Driver console" signOutDisabled={onTrip || busy}>
      <ScrollView contentContainerStyle={{ gap: 16 }} showsVerticalScrollIndicator={false}>
        <View style={styles.pill} accessibilityRole="text">
          <View style={[styles.statusDot, { backgroundColor: connected ? t.green : t.amber }]} />
          <Text style={{ color: t.muted, fontSize: 13 }}>{connected ? 'Live updates connected' : 'Reconnecting'}</Text>
        </View>

        {notice ? (
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.amber }]} accessibilityLiveRegion="polite">
            <Text style={{ color: t.text, fontSize: 16 }}>{notice}</Text>
            <Button label="Dismiss" variant="secondary" onPress={() => setNotice('')} />
          </View>
        ) : null}

        {!assignment && !loadError ? <ActivityIndicator color={t.accent} /> : null}

        {loadError && !assignment ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: t.red, fontSize: 16 }}>{loadError}</Text>
            <Button label="Retry" variant="secondary" onPress={refresh} />
          </View>
        ) : null}

        {assignment && !v ? (
          <Text style={{ color: t.textSecondary, fontSize: 17 }}>
            No vehicle is assigned to you. Contact your transport authority.
          </Text>
        ) : null}

        {v ? (
          <>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: sharing ? t.green : t.border }]}>
              <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }}>{v.vehicleNumber}</Text>
              <Text style={{ color: t.textSecondary, fontSize: 15 }}>
                {[v.plateNumber, v.model, v.capacity ? `${v.capacity} seats` : null].filter(Boolean).join(' · ')}
              </Text>
              <Text style={{ color: t.muted, fontSize: 15 }}>{v.assignedRoute ?? 'No route assigned. You are on demand.'}</Text>
            </View>

            {sharing ? (
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.green }]} accessibilityLiveRegion="polite">
                <View style={styles.liveRow}>
                  <PulseDot color={t.red} />
                  <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', flexShrink: 1 }}>
                    Live Location Sharing is ACTIVE
                  </Text>
                </View>
                <Text style={{ color: t.textSecondary, fontSize: 15 }}>
                  Elapsed {formatElapsed(now - new Date(assignment!.activeTrip!.startedAt).getTime())}
                  {fix?.speed != null ? ` · ${Math.round(fix.speed * 3.6)} km/h` : ''}
                </Text>
                <Text style={{ color: t.muted, fontSize: 14 }}>
                  {fix
                    ? `${fix.latitude.toFixed(5)}°, ${fix.longitude.toFixed(5)}°${fix.accuracy != null ? ` · accuracy ${Math.round(fix.accuracy)} m` : ''}`
                    : now - new Date(assignment!.activeTrip!.startedAt).getTime() > 30_000
                      ? 'Still no GPS fix. Check that Location is on and the phone can see the sky.'
                      : 'Waiting for the first GPS fix…'}
                </Text>
                {live.queued > 0 ? (
                  <Text style={{ color: t.amber, fontSize: 15, fontWeight: '600' }}>
                    {live.queued} point{live.queued === 1 ? '' : 's'} waiting to upload. They are sent when the connection returns.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {trackError ? (
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.red }]} accessibilityLiveRegion="polite">
                <Text style={{ color: t.red, fontSize: 16, fontWeight: '600' }}>Location sharing is off</Text>
                <Text style={{ color: t.text, fontSize: 15 }}>{trackError}</Text>
                <Button label="Try again" variant="secondary" onPress={refresh} />
              </View>
            ) : null}

            {ending ? (
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.amber }]} accessibilityLiveRegion="polite">
                <Text style={{ color: t.amber, fontSize: 16, fontWeight: '600' }}>Trip not ended yet</Text>
                <Text style={{ color: t.text, fontSize: 15 }}>
                  {live.queued} point{live.queued === 1 ? '' : 's'} still need to upload before the trip can end. Location sharing is off.
                </Text>
              </View>
            ) : null}

            {actionError ? <Text style={{ color: t.red, fontSize: 15 }} accessibilityLiveRegion="polite">{actionError}</Text> : null}

            {onTrip ? (
              <Button label={ending ? 'Finish ending trip' : 'End trip'} onPress={ending ? end : confirmEnd} busy={busy} />
            ) : (
              <Button label="Start trip" onPress={start} busy={busy} />
            )}
            <Text style={{ color: t.muted, fontSize: 14 }}>
              {onTrip ? 'Location sharing stops the moment you end the trip.' : 'Location sharing starts when you start the trip.'}
            </Text>

            {stops.length ? (
              <View style={{ gap: 12 }}>
                <Text style={{ color: t.textSecondary, fontSize: 14, fontWeight: '600' }}>Route stops</Text>
                <Stepper stops={stops} current={-1} />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </RoleScreen>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 8 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
