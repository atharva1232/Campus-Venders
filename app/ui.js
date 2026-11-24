import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

export const colors = {
  forest: '#16302a',
  forestDeep: '#10251f',
  orange: '#e2672b',
  orangeDark: '#9c4219',
  cream: '#f5f0e6',
  surface: '#fffdfa',
  muted: '#53665d',
  line: '#e6ded0',
  sage: '#e6eee4',
  peach: '#f9e8d7',
  white: '#ffffff',
  danger: '#9b372c',
};

export const Icon = Ionicons;

export function Action({ label, icon, onPress, tone = 'primary', disabled = false, style }) {
  const textColor = tone === 'primary' ? colors.white : tone === 'danger' ? colors.danger : colors.forest;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        tone === 'primary' && styles.primary,
        tone === 'danger' && styles.danger,
        style,
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.75 },
      ]}
    >
      {icon && <Icon name={icon} size={18} color={textColor} />}
      <Text style={[styles.actionText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, style, ...input }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...input}
        accessibilityLabel={label}
        style={[styles.input, input.multiline && styles.textarea]}
      />
    </View>
  );
}

export function Panel({ title, description, children }) {
  return (
    <View style={styles.panel}>
      {title && <Text style={styles.sectionTitle}>{title}</Text>}
      {description && <Text style={styles.body}>{description}</Text>}
      {children}
    </View>
  );
}

export function Empty({ icon, title, description, action, onPress }) {
  return (
    <View style={styles.empty}>
      <View style={styles.iconTile}><Icon name={icon} size={24} color={colors.forest} /></View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {description && <Text style={[styles.body, styles.center]}>{description}</Text>}
      {action && <Action label={action} onPress={onPress} tone="secondary" />}
    </View>
  );
}

const statusLabels = {
  placed: 'Placed',
  accepted: 'Preparing',
  ready: 'Ready',
  collected: 'Collected',
  rejected: 'Declined',
  no_show: 'Missed pickup',
  canceled: 'Cancelled',
  cancelled: 'Cancelled',
  open: 'Open',
  busy: 'Busy',
  closed: 'Closed',
};

export function Badge({ status }) {
  const positive = ['open', 'ready', 'collected'].includes(status);
  const waiting = ['placed', 'accepted', 'busy'].includes(status);
  const ink = positive ? '#2b6845' : waiting ? '#795019' : '#5a625c';
  const backgroundColor = positive ? '#e6f0e3' : waiting ? '#f8edd7' : '#eeece6';
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <View style={[styles.dot, { backgroundColor: ink }]} />
      <Text style={[styles.badgeLabel, { color: ink }]}>{statusLabels[status] || 'Status unknown'}</Text>
    </View>
  );
}

export function Choice({ label, icon, selected, onPress }) {
  const color = selected ? colors.white : colors.forest;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      {icon && <Icon name={icon} size={15} color={color} />}
      <Text style={[styles.choiceLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ value, onMinus, onPlus, label, min = 0, max = Infinity }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        disabled={value <= min}
        onPress={onMinus}
        style={[styles.stepButton, value <= min && { opacity: 0.35 }]}
      >
        <Icon name="remove" color={colors.forest} size={18} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        disabled={value >= max}
        onPress={onPlus}
        style={[styles.stepButton, value >= max && { opacity: 0.35 }]}
      >
        <Icon name="add" color={colors.forest} size={18} />
      </Pressable>
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  frame: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', minHeight: 0 },
  scroll: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24, gap: 12 },
  directoryContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 },
  directoryHeader: { gap: 12, paddingBottom: 12 },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    backgroundColor: colors.orange,
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandInitials: { color: colors.forestDeep, fontSize: 15, fontWeight: '900', letterSpacing: -0.5 },
  brandName: { color: colors.forest, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 },
  brandCampus: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  headerEnd: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
  back: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: colors.surface },
  heroTitle: { color: colors.surface, fontSize: 31, lineHeight: 32, fontWeight: '900', letterSpacing: -1.4 },
  heroBody: { color: '#d7e5d9', fontSize: 12, lineHeight: 17 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, minHeight: 49 },
  searchInput: { flex: 1, paddingVertical: 10, color: colors.forest, fontSize: 15 },
  searchClear: { minWidth: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 13, gap: 6, backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.line },
  choiceSelected: { backgroundColor: colors.forest, borderColor: colors.forest },
  choiceLabel: { fontWeight: '700', fontSize: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pageTitle: { color: colors.forest, fontSize: 30, lineHeight: 35, fontWeight: '900', letterSpacing: -1 },
  sectionTitle: { color: colors.forest, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  shopName: { color: colors.forest, fontSize: 16, fontWeight: '800', letterSpacing: -0.25, flexShrink: 1 },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  directoryCard: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 12, gap: 11, flexDirection: 'row', alignItems: 'center' },
  cardGap: { height: 8 },
  iconTile: { backgroundColor: colors.sage, padding: 10, width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  printTile: { backgroundColor: '#e9e9f0' },
  foodTile: { backgroundColor: colors.peach },
  details: { flex: 1, minWidth: 0, gap: 4 },
  detailMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  shopHeader: { padding: 16, backgroundColor: colors.sage, borderRadius: 18, gap: 10 },
  badge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4, gap: 5, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  badgeLabel: { fontSize: 11, fontWeight: '800' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  nav: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6, paddingBottom: 5, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line },
  navItem: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 3, minHeight: 50, borderRadius: 12 },
  navIcon: { minWidth: 46, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  navIconActive: { backgroundColor: colors.sage },
  navText: { color: colors.muted, fontWeight: '600', fontSize: 11 },
  navTextActive: { color: colors.forest, fontWeight: '800' },
  panel: { backgroundColor: colors.surface, borderRadius: 16, borderColor: colors.line, borderWidth: 1, padding: 15, gap: 10 },
  empty: { paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 16 },
  center: { textAlign: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  primary: { backgroundColor: colors.forest, borderColor: colors.forest },
  danger: { backgroundColor: '#fdf0eb', borderColor: '#f1d8cd' },
  actionText: { fontSize: 14, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  field: { gap: 5, minWidth: 0 },
  input: { minHeight: 46, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 11, backgroundColor: colors.surface, color: colors.forest, fontSize: 15 },
  textarea: { minHeight: 82, textAlignVertical: 'top' },
  label: { color: colors.forest, fontSize: 13, fontWeight: '700' },
  link: { color: colors.orangeDark, fontWeight: '800', paddingVertical: 9, textAlign: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 5 },
  wrapRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  divider: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: colors.sage },
  stepButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: colors.forest, fontSize: 14, fontWeight: '800', minWidth: 19, textAlign: 'center' },
  feedback: { padding: 12, borderRadius: 12, backgroundColor: '#fdf0eb', color: colors.danger, fontSize: 13, lineHeight: 19 },
  checkout: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, gap: 5 },
});
