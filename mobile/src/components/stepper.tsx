import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** FR-PAS-03 milestone list. `current` is the index of the stop the bus is nearest to (-1 = not started). */
export function Stepper({ stops, current }: { stops: string[]; current: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {stops.map((name, i) => {
        const here = i === current;
        const passed = i < current;
        const tint = here ? t.green : passed ? t.accent : t.border;
        return (
          <View key={`${i}-${name}`} style={styles.row}>
            <View style={[styles.dot, { borderColor: tint, backgroundColor: here || passed ? tint : 'transparent' }]} />
            <Text style={{ color: here ? t.text : t.textSecondary, fontSize: 16, fontWeight: here ? '700' : '400', flexShrink: 1 }}>
              {name}
            </Text>
            {here ? <Text style={{ color: t.green, fontSize: 13, fontWeight: '600' }}>Nearest</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
});
