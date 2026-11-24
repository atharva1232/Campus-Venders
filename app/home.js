import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Action, Badge, Icon, Panel, colors, styles as S } from './ui';

const heroImage = require('./assets/campus-food.jpg');

export const services = {
  food: {
    title: 'Food & snacks',
    description: 'Browse menus and order ahead',
    icon: 'restaurant-outline',
    tint: colors.peach,
    matches: shop => /food|snack|juice|tiffin|caf[eé]|canteen|tea|meal/i.test(shop.category || ''),
  },
  printing: {
    title: 'Print & Xerox',
    description: 'Find a shop and upload a PDF',
    icon: 'print-outline',
    tint: '#e9e9f0',
    matches: shop => !!shop.print || /print|xerox/i.test(shop.category || ''),
  },
  campus: {
    title: 'Campus shops',
    description: 'Stationery, tailors, and more',
    icon: 'storefront-outline',
    tint: colors.sage,
    matches: shop => !services.food.matches(shop) && !services.printing.matches(shop),
  },
};

function ServiceCard({ title, description, icon, tint, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.serviceCard, pressed && styles.pressed]}
    >
      <View style={S.titleRow}>
        <View style={[styles.iconTile, { backgroundColor: tint }]}>
          <Icon name={icon} color={colors.forest} size={21} />
        </View>
        <Icon name="arrow-forward" color={colors.muted} size={16} />
      </View>
      <Text style={S.shopName}>{title}</Text>
      <Text style={S.caption}>{description}</Text>
    </Pressable>
  );
}

export function Welcome({ goEmail, goGoogle, goMerchant, googleNotice, sessionNotice, busy }) {
  return (
    <ScrollView style={S.scroll} contentContainerStyle={styles.content}>
      <View style={styles.welcomeHero}>
        <Image source={heroImage} resizeMode="cover" style={styles.welcomeImage} />
        <View style={styles.welcomeCopy}>
          <Text accessibilityRole="header" style={S.heroTitle}>Your campus, within reach.</Text>
          <Text style={S.heroBody}>Find food, printing, and shops around RVCE.</Text>
        </View>
      </View>

      <View style={styles.welcomeServices}>
        {Object.values(services).map(({ title, icon, tint }) => (
          <View key={title} style={styles.welcomeService}>
            <View style={[styles.iconTile, { backgroundColor: tint }]}>
              <Icon name={icon} color={colors.forest} size={20} />
            </View>
            <Text style={[S.label, S.center]}>{title}</Text>
          </View>
        ))}
      </View>

      <Panel title="Get started" description="Sign in to explore shops, place an order, or send a print job.">
        {sessionNotice ? <Text accessibilityRole="alert" style={S.body}>{sessionNotice}</Text> : null}
        <Action label="Continue with Google" icon="logo-google" tone="secondary" onPress={goGoogle} disabled={busy} />
        {googleNotice ? <Text accessibilityRole="alert" style={S.body}>{googleNotice}</Text> : null}
        <Action label="Continue with email" icon="mail-outline" onPress={goEmail} disabled={busy} />
      </Panel>

      <Pressable accessibilityRole="button" onPress={goMerchant} style={({ pressed }) => [styles.merchantLink, pressed && styles.pressed]}>
        <Text style={styles.textButtonLabel}>For merchants</Text>
        <Icon name="chevron-forward" size={17} color={colors.orangeDark} />
      </Pressable>
    </ScrollView>
  );
}

export function Home({ me, orders, shops, browse, goOrders }) {
  const firstName = me?.name?.trim().split(/\s+/)[0];
  const nextPickup = orders.find(order => order.status === 'ready')
    || orders.find(order => ['placed', 'accepted'].includes(order.status));
  const pickupShop = nextPickup && shops.find(shop => shop.id === nextPickup.vendorId);

  return (
    <ScrollView style={S.scroll} contentContainerStyle={styles.content}>
      <View style={[S.panel, styles.dashboardIntro]}>
        <Text accessibilityRole="header" style={S.pageTitle}>{firstName ? `Hi, ${firstName}` : 'Campus home'}</Text>
        <Text style={S.body}>What do you need on campus today?</Text>
      </View>

      <View style={styles.serviceSection}>
        <View style={S.titleRow}>
          <Text accessibilityRole="header" style={S.sectionTitle}>Campus services</Text>
          <Pressable accessibilityRole="button" onPress={() => browse()} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>All shops</Text>
            <Icon name="chevron-forward" color={colors.orangeDark} size={15} />
          </Pressable>
        </View>
        <View style={styles.gridRow}>
          <ServiceCard {...services.food} onPress={() => browse('food')} />
          <ServiceCard {...services.printing} onPress={() => browse('printing')} />
        </View>
        <View style={styles.gridRow}>
          <ServiceCard {...services.campus} onPress={() => browse('campus')} />
          <ServiceCard title="Track orders" description="See your pickup token and status" icon="receipt-outline" tint="#f8ecd7" onPress={goOrders} />
        </View>
      </View>

      {nextPickup && (
        <Panel title="Your next pickup">
          <View style={S.titleRow}>
            <Text style={S.shopName}>{pickupShop?.name || 'Campus order'}</Text>
            <Badge status={nextPickup.status} />
          </View>
          <Text style={S.body}>Pickup token {nextPickup.token}</Text>
          <Action label="View orders" icon="receipt-outline" tone="secondary" onPress={goOrders} />
        </Panel>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24, gap: 14 },
  welcomeHero: { borderRadius: 22, overflow: 'hidden', backgroundColor: colors.forest },
  welcomeImage: { width: '100%', height: 168 },
  welcomeCopy: { paddingHorizontal: 18, paddingVertical: 16, gap: 7 },
  welcomeServices: { flexDirection: 'row', justifyContent: 'space-around', gap: 8, paddingVertical: 6 },
  welcomeService: { flex: 1, alignItems: 'center', gap: 3 },
  merchantLink: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, minHeight: 44 },
  dashboardIntro: { backgroundColor: colors.sage, paddingVertical: 20, gap: 6 },
  serviceSection: { gap: 8 },
  gridRow: { flexDirection: 'row', gap: 8 },
  serviceCard: {
    flex: 1,
    minWidth: 0,
    padding: 11,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 4,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  textButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 44,
    paddingLeft: 8,
  },
  textButtonLabel: { color: colors.orangeDark, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
