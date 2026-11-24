import React from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Action, Badge, Choice, Empty, Field, Icon, Panel, Stepper, colors, styles as S } from './ui';

function categoryIcon(category = '') {
  if (/print|xerox/i.test(category)) return 'print-outline';
  if (/snack|juice/i.test(category)) return 'cafe-outline';
  if (/food|meal/i.test(category)) return 'restaurant-outline';
  if (/stationery/i.test(category)) return 'pencil-outline';
  if (/tailor/i.test(category)) return 'cut-outline';
  return 'storefront-outline';
}

export function ShopIcon({ shop }) {
  const icon = categoryIcon(shop.category);
  return (
    <View style={[
      S.iconTile,
      icon === 'print-outline' && S.printTile,
      ['restaurant-outline', 'cafe-outline'].includes(icon) && S.foodTile,
    ]}>
      <Icon name={icon} size={22} color={colors.forest} />
    </View>
  );
}

export function Explore({ shops, visible, category, categories, setCategory, query, setQuery, loading, error, refresh, onShopPress, serviceTitle, clearService }) {
  function clearFilters() {
    setQuery('');
    clearService();
  }

  return (
    <FlatList
      style={S.scroll}
      data={visible}
      keyExtractor={shop => shop.id}
      refreshing={loading}
      onRefresh={refresh}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={S.directoryContent}
      ItemSeparatorComponent={() => <View style={S.cardGap} />}
      ListHeaderComponent={
        <View style={S.directoryHeader}>
          <View style={S.titleRow}>
            <Text accessibilityRole="header" style={[S.pageTitle, { flexShrink: 1 }]}>{serviceTitle || 'Explore shops'}</Text>
            {serviceTitle && <Choice label="All shops" icon="grid-outline" onPress={clearService} />}
          </View>
          <View style={S.search}>
            <Icon name="search-outline" size={20} color={colors.muted} />
            <TextInput
              accessibilityLabel="Search the directory"
              placeholder="Search shops, food, or printing"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
              style={S.searchInput}
            />
            {query.length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={S.searchClear}>
                <Icon name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            )}
          </View>
          {categories.length > 1 && (
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={S.chips}>
              {categories.map(cat => (
                <Choice key={cat} label={cat === 'All' ? 'All' : cat} icon={cat === 'All' ? 'grid-outline' : categoryIcon(cat)} selected={category === cat} onPress={() => setCategory(cat)} />
              ))}
            </ScrollView>
          )}
          <View style={S.titleRow}>
            <Text accessibilityRole="header" style={S.sectionTitle}>Campus directory</Text>
            {shops.length > 0 && <Text style={S.caption}>{visible.length} {visible.length === 1 ? 'shop' : 'shops'}</Text>}
          </View>
        </View>
      }
      ListEmptyComponent={
        error
          ? <Empty icon="cloud-offline-outline" title="Couldn’t load shops" description={error} action="Try again" onPress={refresh} />
          : !loading && (query || category !== 'All' || serviceTitle
            ? <Empty icon="search-outline" title="No matching shops" action="Clear filters" onPress={clearFilters} />
            : <Empty icon="storefront-outline" title="No shops listed yet" action="Refresh directory" onPress={refresh} />)
      }
      renderItem={({ item: shop }) => (
        <Pressable accessibilityRole="button" onPress={() => onShopPress(shop)} style={({ pressed }) => [S.directoryCard, pressed && { opacity: 0.7 }]}>
          <ShopIcon shop={shop} />
          <View style={S.details}>
            <View style={S.titleRow}>
              <Text style={S.shopName}>{shop.name}</Text>
              <Badge status={shop.status} />
            </View>
            <Text style={S.caption} numberOfLines={1}>{shop.category} · {shop.location}</Text>
            <View style={S.detailMeta}>
              <Icon name="time-outline" size={15} color={colors.muted} />
              <Text style={S.caption}>~{shop.avgServe || 2} min service · {shop.queue || 0} in queue</Text>
            </View>
          </View>
          <Icon name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>
      )}
    />
  );
}

export function ShopDetails({
  shop, cart, changeQuantity, warningFeePercent, placeOrder, money,
  printFile, printPages, printCopies, setPrintPages, setPrintCopies, pickPrintFile, submitPrint, submittingOrder,
}) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const withWarningFee = amount => amount + Math.round(amount * (warningFeePercent || 0)) / 100;
  const printSubtotal = (Number(printPages) || 1) * (Number(printCopies) || 1) * (shop.print?.bw || 0);
  return (
    <>
      <ScrollView style={S.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={S.content}>
        <View style={S.shopHeader}>
          <View style={S.itemRow}>
            <ShopIcon shop={shop} />
            <Badge status={shop.status} />
          </View>
          <Text accessibilityRole="header" style={S.pageTitle}>{shop.name}</Text>
          <View style={S.detailMeta}>
            <Icon name="location-outline" size={15} color={colors.muted} />
            <Text style={S.body}>{shop.location || 'Near campus'}</Text>
          </View>
          <View style={S.detailMeta}>
            <Icon name="time-outline" size={15} color={colors.muted} />
            <Text style={S.body}>{shop.queue || 0} in queue · ~{shop.avgServe || 2} min service</Text>
          </View>
          {shop.note ? <Text style={S.body}>{shop.note}</Text> : null}
        </View>
        {shop.menu?.length > 0 && (
          <Panel title="Menu">
            {shop.menu.map((item, index) => {
              const count = cart.find(entry => entry.id === item.id)?.qty || 0;
              return (
                <View key={item.id || index} style={[S.itemRow, index > 0 && S.divider]}>
                  <View style={S.details}>
                    <Text style={S.shopName}>{item.name}</Text>
                    <Text style={S.body}>{money(item.price)}{item.inStock === false ? ' · Sold out' : ''}</Text>
                  </View>
                  {count > 0 ? (
                    <Stepper label={item.name} value={count} max={item.inStock === false ? count : 50} onMinus={() => changeQuantity(item, -1)} onPlus={() => changeQuantity(item, 1)} />
                  ) : (
                    <Action label="Add" icon="add" tone="secondary" disabled={item.inStock === false} onPress={() => changeQuantity(item, 1)} />
                  )}
                </View>
              );
            })}
          </Panel>
        )}
        {shop.print && (
          <Panel title="Print a PDF">
            <Action label={printFile?.name || 'Choose PDF'} icon="document-attach-outline" tone="secondary" onPress={pickPrintFile} disabled={submittingOrder} />
            <View style={S.wrapRow}>
              <Field style={{ flex: 1 }} label="Pages" keyboardType="number-pad" value={printPages} onChangeText={setPrintPages} />
              <Field style={{ flex: 1 }} label="Copies" keyboardType="number-pad" value={printCopies} onChangeText={setPrintCopies} />
            </View>
            <Text style={S.body}>Black and white · Single sided · Est. {money(withWarningFee(Math.round(printSubtotal)))}</Text>
            {warningFeePercent > 0 && <Text style={S.caption}>Estimate includes a {warningFeePercent}% missed pickup fee.</Text>}
            <Action label={submittingOrder ? 'Submitting…' : 'Submit print job'} onPress={submitPrint} disabled={!printFile || submittingOrder} />
          </Panel>
        )}
        {!shop.menu?.length && !shop.print && (
          <Empty icon="restaurant-outline" title="No menu listed" description="Visit the shop for today’s options." />
        )}
      </ScrollView>
      {cart.length > 0 && (
        <View style={S.checkout}>
          {warningFeePercent > 0 && <Text style={S.caption}>A {warningFeePercent}% missed pickup fee goes to the shop.</Text>}
          <Action
            label={submittingOrder ? 'Placing order…' : `Place order · ${money(withWarningFee(subtotal))}`}
            icon="basket-outline"
            onPress={placeOrder}
            disabled={submittingOrder}
          />
        </View>
      )}
    </>
  );
}
