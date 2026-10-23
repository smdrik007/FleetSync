import type { ReactNode } from 'react';
import { useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { MIN_TOUCH, radius, useTheme } from '@/lib/theme';

/** Tab-friendly screen frame: safe-area top padding, a title, optional pull-to-refresh. The tab bar owns the bottom inset. */
export function Screen({
  title, subtitle, right, children, onRefresh, refreshing = false, scroll = true,
}: {
  title: string; subtitle?: string; right?: ReactNode; children?: ReactNode;
  onRefresh?: () => void; refreshing?: boolean; scroll?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const head = (
    <View style={styles.head}>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>{title}</Text>
        {subtitle ? <Text style={{ color: t.muted, fontSize: 14 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 12 }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}
          keyboardShouldPersistTaps="handled">
          {head}
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 16, gap: 12 }}>
          {head}
          {children}
        </View>
      )}
    </View>
  );
}

export function Card({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  const t = useTheme();
  const style = [styles.card, { backgroundColor: t.surface, borderColor: t.border }];
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [...style, { opacity: pressed ? 0.85 : 1 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'accent' | 'muted';
export function Badge({ label, tone = 'muted' }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const color = tone === 'muted' ? t.muted : t[tone];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Kpi({ label, value, foot }: { label: string; value: string; foot?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.kpi, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>{value}</Text>
      {foot ? <Text style={{ color: t.muted, fontSize: 12 }}>{foot}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={{ color: t.textSecondary, fontSize: 14, fontWeight: '700', marginTop: 8 }}>{children.toUpperCase()}</Text>;
}

export function Row({ label, value }: { label: string; value?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.kvRow}>
      <Text style={{ color: t.muted, fontSize: 14 }}>{label}</Text>
      {typeof value === 'string' || value === undefined || value === null
        ? <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value || '—'}</Text>
        : value}
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
      <Text style={{ color: t.red, fontSize: 15 }}>{message}</Text>
      {onRetry ? <Button label="Retry" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.textSecondary, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        {...props}
        style={[styles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }, props.multiline ? { minHeight: 100, textAlignVertical: 'top' } : null]}
      />
    </View>
  );
}

export type Option = { value: string; label: string; hint?: string };

/** A button-like field that opens a list of options in a bottom sheet. `emptyLabel` adds a "None" choice with value ''. */
export function PickerField({
  label, value, options, onChange, emptyLabel,
}: { label: string; value: string; options: Option[]; onChange: (v: string) => void; emptyLabel?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const all = emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options;
  const current = all.find((o) => o.value === value)?.label ?? 'Choose…';
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.textSecondary, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} onPress={() => setOpen(true)}
        style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, justifyContent: 'center' }]}>
        <Text style={{ color: t.text, fontSize: 16 }}>{current}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.bg, borderColor: t.border }]}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>{label}</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {all.map((o) => (
              <Pressable
                key={o.value || '__none'} accessibilityRole="button" onPress={() => { onChange(o.value); setOpen(false); }}
                style={[styles.option, { borderColor: t.border }]}>
                <Text style={{ color: o.value === value ? t.accent : t.text, fontSize: 16, fontWeight: o.value === value ? '700' : '500' }}>{o.label}</Text>
                {o.hint ? <Text style={{ color: t.muted, fontSize: 13 }}>{o.hint}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
          <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 },
  title: { fontSize: 26, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 6 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  kpi: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 2 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 32 },
  input: { minHeight: MIN_TOUCH - 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 16, gap: 8, paddingBottom: 28 },
  option: { minHeight: MIN_TOUCH - 8, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
