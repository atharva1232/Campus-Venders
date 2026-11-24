import React, { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Action, Badge, Choice, Empty, Field, Icon, Panel, Stepper, colors, styles as S } from './ui';

function Page({ title, children }) {
  return (
    <ScrollView style={S.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={S.content}>
      <Text accessibilityRole="header" style={S.pageTitle}>{title}</Text>
      {children}
    </ScrollView>
  );
}

const orderSummary = order => order.type === 'print'
  ? order.print?.fileName || 'PDF print job'
  : order.items?.map(item => `${item.qty} × ${item.name}`).join(', ');

export function Orders({ signedIn, orders, goAccount, goExplore, money, cancel, rate, shops }) {
  return (
    <Page title="Your orders">
      {!signedIn ? (
        <Empty icon="receipt-outline" title="Sign in to see your orders" description="Check your pickup token and order status here." action="Sign in" onPress={goAccount} />
      ) : orders.length === 0 ? (
        <Empty icon="receipt-outline" title="No orders yet" action="Explore shops" onPress={goExplore} />
      ) : orders.map(order => (
        <Panel key={order.id}>
          <View style={S.titleRow}>
            <Text style={S.shopName}>{shops.find(shop => shop.id === order.vendorId)?.name || 'Campus order'}</Text>
            <Badge status={order.status} />
          </View>
          <Text style={S.body}>{orderSummary(order)}</Text>
          <View style={[S.itemRow, S.divider]}>
            <Text style={S.label}>Pickup {order.token}</Text>
            <Text style={S.shopName}>{money(order.total)}</Text>
          </View>
          {order.status === 'placed' && <Action label="Cancel order" tone="danger" onPress={() => cancel(order)} />}
          {order.status === 'collected' && !order.rating && (
            <>
              <Text style={S.label}>Rate your order</Text>
              <View style={S.wrapRow}>
                {[1, 2, 3, 4, 5].map(stars => (
                  <Pressable key={stars} accessibilityRole="button" accessibilityLabel={`Rate ${stars} out of 5`} onPress={() => rate(order, stars)} style={[S.choice, { paddingHorizontal: 10 }]}>
                    <Text style={S.label}>{stars}</Text>
                    <Icon name="star" size={15} color={colors.orangeDark} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </Panel>
      ))}
    </Page>
  );
}

export function Account({
  me, signedIn, authView, pending, email, code, name, cls, phone, setEmail, setCode, setName, setCls, setPhone,
  codeSent, devCode, busy, error, toggleAuthView, editEmail, submit, resendCode, googleSignIn,
  feedback, setFeedback, sendFeedback, logout, openPrivacy, deleteAccount,
}) {
  const needsProfile = !!pending || authView === 'signup';
  const title = signedIn ? 'Your account' : pending ? 'Finish your profile' : codeSent ? 'Check your inbox' : authView === 'signup' ? 'Create an account' : 'Sign in';
  const action = pending ? 'Save profile' : codeSent ? 'Verify code' : 'Email me a sign-in code';
  return (
    <Page title={title}>
      {signedIn ? (
        <>
          <Panel title={me?.name || 'Student'} description={me?.email}>
            <Text style={S.body}>{[me?.cls, me?.phone].filter(Boolean).join(' · ')}</Text>
            <Text style={S.label}>Warnings: {me?.strikes || 0}</Text>
          </Panel>
          <Panel title="Feedback">
            <Field label="Message" placeholder="Share feedback with the team" multiline value={feedback} onChangeText={setFeedback} />
            <Action label="Send feedback" icon="paper-plane-outline" tone="secondary" onPress={sendFeedback} disabled={feedback.trim().length < 5} />
          </Panel>
          <Action label="Sign out" icon="log-out-outline" tone="secondary" onPress={logout} />
          <Action label="Privacy and account data" icon="shield-checkmark-outline" tone="secondary" onPress={openPrivacy} />
          <Action label="Delete account" icon="trash-outline" tone="danger" onPress={deleteAccount} />
        </>
      ) : (
        <Panel description={pending ? undefined : codeSent ? `Enter the six-digit code sent to ${email.trim()}.` : 'Use your Gmail address to receive a one-time sign-in code.'}>
          {needsProfile && (pending || !codeSent) && (
            <>
              <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
              <Field label="Class or department" value={cls} onChangeText={setCls} />
              <Field label="Mobile number" placeholder="10-digit mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
            </>
          )}
          {!pending && !codeSent && <Field label="Gmail address" placeholder="you@gmail.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} />}
          {!pending && codeSent && (
            <>
              <Field label="Six-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
              {devCode ? <Text style={S.caption}>Local development code: {devCode}</Text> : null}
            </>
          )}
          {error ? <Text accessibilityRole="alert" style={S.feedback}>{error}</Text> : null}
          <Action label={busy ? 'Please wait…' : action} onPress={submit} disabled={busy || (codeSent && !pending && code.length !== 6)} />
          {codeSent && !pending && <Action label="Request another code" tone="secondary" onPress={resendCode} disabled={busy} />}
          {googleSignIn && !pending && !codeSent && authView === 'login' && <Action label="Continue with Google" icon="logo-google" tone="secondary" onPress={googleSignIn} disabled={busy} />}
          {!pending && (
            <Pressable accessibilityRole="button" onPress={codeSent ? editEmail : toggleAuthView}>
              <Text style={S.link}>{codeSent ? 'Use a different email' : authView === 'signup' ? 'Already registered? Sign in' : 'New student? Create an account'}</Text>
            </Pressable>
          )}
          <Text style={S.caption}>Sign-in IP is used for account security. People on shared campus Wi-Fi can have the same IP.</Text>
        </Panel>
      )}
    </Page>
  );
}

const statusActions = {
  placed: [['accepted', 'Accept'], ['rejected', 'Decline']],
  accepted: [['ready', 'Mark ready']],
  ready: [['collected', 'Mark collected'], ['no_show', 'Mark missed pickup']],
};

export function Merchant({
  vendor, orders, form, setForm, busy, error, signIn, apply, money, updateShop,
  merchantCode, resetMerchantCode, openPrivacy,
  shopNote, setShopNote, itemName, setItemName, itemPrice, setItemPrice, addItem, updateOrder, downloadPrint, signOut,
}) {
  const [credentials, setCredentials] = useState({ shop: '', email: '', code: '' });

  function loginField(label, key, options = {}) {
    return <Field label={label} value={credentials[key]} onChangeText={value => setCredentials(previous => ({ ...previous, [key]: value }))} {...options} />;
  }

  function field(label, key, options = {}) {
    return <Field label={label} value={String(form[key] ?? '')} onChangeText={value => setForm(previous => ({ ...previous, [key]: value }))} {...options} />;
  }

  return (
    <Page title={vendor?.name || (vendor ? 'Shop dashboard' : 'Merchant tools')}>
      {error ? <Text accessibilityRole="alert" style={S.feedback}>{error}</Text> : null}
      {vendor ? (
        <>
          <Panel title="Shop status">
            <View style={S.wrapRow}>
              {['open', 'busy', 'closed'].map(status => (
                <Choice key={status} label={status[0].toUpperCase() + status.slice(1)} selected={vendor.status === status} onPress={() => updateShop({ status })} />
              ))}
            </View>
            <View style={[S.itemRow, S.divider]}>
              <Text style={S.label}>People in queue</Text>
              <Stepper label="queue count" value={vendor.queue || 0} max={200} onMinus={() => updateShop({ queue: (vendor.queue || 0) - 1 })} onPlus={() => updateShop({ queue: (vendor.queue || 0) + 1 })} />
            </View>
            <Field label="Shop announcement" value={shopNote ?? vendor.note ?? ''} onChangeText={setShopNote} />
            <Action label="Save announcement" tone="secondary" disabled={shopNote == null} onPress={() => updateShop({ note: shopNote })} />
          </Panel>
          <Panel title="Menu">
            {(vendor.menu || []).map((item, index) => (
              <View key={item.id || index} style={S.itemRow}>
                <Text style={S.label}>{item.name} · {money(item.price)}</Text>
                <Switch accessibilityLabel={`${item.name} in stock`} value={item.inStock !== false} trackColor={{ true: colors.forest }} onValueChange={inStock => updateShop({ menu: vendor.menu.map(entry => entry.id === item.id ? { ...entry, inStock } : entry) })} />
              </View>
            ))}
            <Field label="New item name" value={itemName} onChangeText={setItemName} />
            <Field label="Price in rupees" keyboardType="decimal-pad" value={itemPrice} onChangeText={setItemPrice} />
            <Action label="Add menu item" icon="add" onPress={addItem} />
          </Panel>
          <Text style={S.sectionTitle}>Orders</Text>
          {orders.length === 0 && <Empty icon="receipt-outline" title="No orders yet" />}
          {orders.map(order => (
            <Panel key={order.id}>
              <View style={S.titleRow}>
                <Text style={S.shopName}>Pickup {order.token}</Text>
                <Badge status={order.status} />
              </View>
              <Text style={S.body}>{[order.student?.name, orderSummary(order)].filter(Boolean).join(' · ')}</Text>
              <Text style={S.label}>Collect {money(order.total)}{order.warningFee ? ` · includes ${order.warningFee.percent}% merchant bonus` : ''}</Text>
              {order.type === 'print' && order.print?.hasFile && <Action label="Download PDF" icon="download-outline" tone="secondary" onPress={() => downloadPrint(order)} />}
              {(statusActions[order.status] || []).map(([status, label]) => (
                <Action key={status} label={label} onPress={() => updateOrder(order, status)} tone={['rejected', 'no_show'].includes(status) ? 'danger' : 'secondary'} />
              ))}
            </Panel>
          ))}
          <Action label="Sign out of shop" icon="log-out-outline" tone="secondary" onPress={signOut} />
          <Action label="Privacy and account data" icon="shield-checkmark-outline" tone="secondary" onPress={openPrivacy} />
        </>
      ) : (
        <>
          <Panel title="Merchant sign-in" description={merchantCode ? `Enter the six-digit code sent to ${credentials.email.trim()}.` : 'Use the Gmail address on your approved shop application.'}>
            {merchantCode ? (
              <>
                {loginField('Six-digit code', 'code', { keyboardType: 'number-pad', maxLength: 6, autoComplete: 'one-time-code' })}
                {merchantCode.devCode ? <Text style={S.caption}>Local development code: {merchantCode.devCode}</Text> : null}
              </>
            ) : (
              <>
                {loginField('Shop name', 'shop')}
                {loginField('Owner Gmail', 'email', { keyboardType: 'email-address', autoCapitalize: 'none', autoComplete: 'email' })}
              </>
            )}
            <Action label={busy ? 'Please wait…' : merchantCode ? 'Verify code' : 'Email me a sign-in code'} icon="log-in-outline"
              onPress={() => signIn(credentials)} disabled={busy || (!!merchantCode && credentials.code.length !== 6)}
            />
            {merchantCode && <Action label="Use a different shop or request a new code" tone="secondary" disabled={busy} onPress={() => {
              setCredentials(previous => ({ ...previous, code: '' }));
              resetMerchantCode();
            }} />}
          </Panel>
          <Panel title="Register a shop" description="Your shop appears in the directory after approval by email.">
            {field('Shop name', 'name')}
            {field('Category', 'category', { placeholder: 'Food, print, stationery…' })}
            {field('Location', 'location')}
            {field('Phone', 'phone', { keyboardType: 'phone-pad' })}
            {field('Owner email', 'ownerEmail', { keyboardType: 'email-address', autoCapitalize: 'none' })}
            <View style={S.wrapRow}>
              {field('Opens at', 'openTime', { placeholder: '08:00', style: { flex: 1 } })}
              {field('Closes at', 'closeTime', { placeholder: '20:00', style: { flex: 1 } })}
            </View>
            <View style={S.itemRow}>
              <Text style={S.label}>Offers printing</Text>
              <Switch accessibilityLabel="Offers printing" value={!!form.printShop} trackColor={{ true: colors.forest }} onValueChange={printShop => setForm(previous => ({ ...previous, printShop }))} />
            </View>
            {!!form.printShop && (
              <>
                {field('B/W price per page', 'printBw', { keyboardType: 'decimal-pad' })}
                {field('Colour price per page', 'printColor', { keyboardType: 'decimal-pad' })}
                {field('Binding price', 'printBinding', { keyboardType: 'decimal-pad' })}
              </>
            )}
            <Action label="Submit shop application" icon="paper-plane-outline" onPress={apply} disabled={busy} />
          </Panel>
        </>
      )}
    </Page>
  );
}
