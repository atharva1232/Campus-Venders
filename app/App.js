import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { isRunningInExpoGo } from 'expo';
import { Explore, ShopDetails } from './directory';
import { Account, Merchant, Orders } from './flows';
import { Home, Welcome, services } from './home';
import { clearNativeGoogleSession, nativeGoogleConfigured, signInWithNativeGoogle } from './native-google';
import { Icon, colors, styles as S } from './ui';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

WebBrowser.maybeCompleteAuthSession();
const API = (process.env.EXPO_PUBLIC_API_URL || 'https://campus-vendors-mobile-api.onrender.com').replace(/\/+$/, '');
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const TABS = [
  { label: 'Home', icon: 'home' },
  { label: 'Explore', icon: 'compass' },
  { label: 'Orders', icon: 'receipt' },
  { label: 'Shop', icon: 'storefront' },
  { label: 'Account', icon: 'person' },
];
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = amount => rupees.format(Number(amount) || 0);
const normalize = x => (Array.isArray(x) ? x : []).map(v => ({...v, id:v.id || v._id}));
const storage = {
  get: key => Platform.OS === 'web' ? Promise.resolve(window.localStorage.getItem(key)) : SecureStore.getItemAsync(key),
  set: (key, value) => Platform.OS === 'web' ? Promise.resolve(window.localStorage.setItem(key, value)) : SecureStore.setItemAsync(key, value),
  remove: key => Platform.OS === 'web' ? Promise.resolve(window.localStorage.removeItem(key)) : SecureStore.deleteItemAsync(key),
};

export default function App() {
  return (
    <SafeAreaProvider style={S.safe}>
      <CampusVendors />
    </SafeAreaProvider>
  );
}

function CampusVendors() {
  const [token,setToken]=useState(null), [me,setMe]=useState(null), [shops,setShops]=useState([]), [orders,setOrders]=useState([]), [cart,setCart]=useState([]);
  const [tab, setTab] = useState('Home');
  const [language, setLanguage] = useState('en');
  const [guestPage, setGuestPage] = useState('Welcome');
  const [restoringSession, setRestoringSession] = useState(true);
  const [sessionNotice, setSessionNotice] = useState('');
  const [service, setService] = useState(null);
  const [googleNotice, setGoogleNotice] = useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [authView,setAuthView]=useState('login'), [codeSent,setCodeSent]=useState(false), [devCode,setDevCode]=useState(''), [pending,setPending]=useState('');
  const [email,setEmail]=useState(''), [code,setCode]=useState(''), [name,setName]=useState(''), [cls,setCls]=useState(''), [phone,setPhone]=useState(''), [query,setQuery]=useState(''), [category,setCategory]=useState('All'), [selected,setSelected]=useState(null), [vendorToken,setVendorToken]=useState(null), [vendor,setVendor]=useState(null), [vendorOrders,setVendorOrders]=useState([]);
  const [form,setForm]=useState({}), [itemName,setItemName]=useState(''), [itemPrice,setItemPrice]=useState(''), [shopNote,setShopNote]=useState(null), [printFile,setPrintFile]=useState(null), [printPages,setPrintPages]=useState('1'), [printCopies,setPrintCopies]=useState('1'), [feedbackMessage,setFeedbackMessage]=useState('');
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const orderWrite = useRef(false);
  const orderDraft = useRef(null);
  const [merchantCode, setMerchantCode] = useState(null);
  const webGoogleClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: webGoogleClientId || 'preview-disabled.apps.googleusercontent.com',
    prompt: 'select_account',
  });
  const request = useCallback(async (path, method = 'GET', body = null, auth = token, shopToken = vendorToken) => {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${auth}`;
    if (shopToken) headers['x-vendor-token'] = shopToken;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), body?.type === 'print' ? 60_000 : 20_000);
    try {
      const response = await fetch(`${API}${path}`, {
        method, headers, signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The service is unavailable. Try again in a moment.');
      if (!data) throw new Error('The service returned an invalid response.');
      return data;
    } catch (err) {
      if (controller.signal.aborted) throw new Error('The request timed out. Please try again.');
      if (err instanceof TypeError) throw new Error('Couldn’t reach Campus Vendors. Check your connection and try again.');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }, [token, vendorToken]);
  const sync = useCallback(async (studentToken, merchantToken) => {
    const data = await request('/api/sync', 'GET', null, studentToken, merchantToken);
    const nextShops = normalize(data.vendors);
    setShops(nextShops);
    setMe(data.me || null);
    setOrders(normalize(data.myOrders));
    if (studentToken && studentToken === token && !data.me) {
      await storage.remove('student-token');
      setToken(null);
      setCart([]);
      orderDraft.current = null;
      setSelected(null);
      setGuestPage('Welcome');
      setSessionNotice(data.blocked ? 'Your student account is blocked.' : 'Your session ended. Sign in to continue.');
    }
    if (merchantToken && data.vendorId) {
      setVendor(nextShops.find(shop => shop.id === data.vendorId) || { id: data.vendorId });
      setVendorOrders(normalize(data.vendorOrders));
    }
    return data;
  }, [request, token]);

  const refresh = (studentToken = token) => sync(studentToken, vendorToken);
  async function refreshDirectory(studentToken = token) {
    setLoadingDirectory(true);
    setDirectoryError('');
    try {
      await refresh(studentToken);
    } catch (err) {
      setDirectoryError(err.message);
    } finally {
      setLoadingDirectory(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const savedLanguage = await storage.get('app-language').catch(() => null);
        if (['en', 'hi', 'kn'].includes(savedLanguage)) setLanguage(savedLanguage);
        const [savedStudent, savedMerchant] = await Promise.all([
          storage.get('student-token'),
          storage.get('vendor-token'),
        ]);
        if (!savedStudent && !savedMerchant) return;

        const data = await sync(savedStudent, savedMerchant);
        if (savedStudent && data.me) {
          setToken(savedStudent);
        } else if (savedStudent) {
          await storage.remove('student-token');
          setSessionNotice(data.blocked ? 'Your student account is blocked.' : 'Your session expired. Sign in again to continue.');
        }
        if (savedMerchant && data.vendorId) {
          setVendorToken(savedMerchant);
          if (!data.me) setGuestPage('Shop');
        } else if (savedMerchant) {
          await storage.remove('vendor-token');
        }
      } catch (err) {
        setSessionNotice('Couldn’t restore your session. Check your connection and sign in again.');
      } finally {
        setRestoringSession(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const idToken = googleResponse.authentication?.idToken || googleResponse.params?.id_token;
      if (idToken) completeGoogle(idToken);
      else setError('Google did not return an ID token.');
    } else if (googleResponse?.type === 'error') {
      setError('Google sign-in could not be completed. Try again or use email.');
    }
  }, [googleResponse]);

  const directoryShops = useMemo(() => service ? shops.filter(services[service].matches) : shops, [service, shops]);
  const categories = useMemo(() => ['All', ...new Set(directoryShops.map(shop => shop.category).filter(Boolean))], [directoryShops]);
  const search = query.trim().toLowerCase();
  const visible = directoryShops.filter(shop => {
    if (category !== 'All' && shop.category !== category) return false;
    const menuNames = (shop.menu || []).map(item => item.name);
    return [shop.name, shop.category, shop.location, ...menuNames]
      .some(value => String(value || '').toLowerCase().includes(search));
  });
  const selectedCart = cart.filter(item => item.vendorId === selected?.id);

  function changeQuantity(item, delta) {
    setCart(previous => {
      const matches = entry => entry.id === item.id && entry.vendorId === selected.id;
      const existing = previous.find(matches);
      if (!existing) return [...previous, { ...item, vendorId: selected.id, qty: 1 }];
      const qty = Math.max(0, Math.min(50, existing.qty + delta));
      return qty
        ? previous.map(entry => matches(entry) ? { ...entry, qty } : entry)
        : previous.filter(entry => !matches(entry));
    });
  }
  function buyAgain(shop, item) {
    if (!shop || !item) return;
    setSelected(shop);
    setPrintFile(null);
    setCart(previous => {
      const existing = previous.find(entry => entry.id === item.id && entry.vendorId === shop.id);
      if (existing) return previous.map(entry => entry.id === item.id && entry.vendorId === shop.id ? { ...entry, qty: Math.min(50, entry.qty + 1) } : entry);
      return [...previous, { ...item, vendorId: shop.id, qty: 1 }];
    });
  }
  async function sendCode(){try{setBusy(true);const d=await request('/api/mobile/auth/send-code','POST',{email:email.trim().toLowerCase(),...(authView==='signup'?{details:{name,cls,phone}}:{})},null);setDevCode(d.devCode||'');setCodeSent(true);setError('');}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function verifyCode(){try{setBusy(true);const d=await request('/api/mobile/auth/verify','POST',{email:email.trim().toLowerCase(),code},null);if(d.needsProfile){setPending(d.pendingToken);setError('Add your name, class and mobile number to finish creating your account.');return}await finishLogin(d.token,d.student)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function finishProfile(){try{setBusy(true);const d=await request('/api/mobile/auth/finish','POST',{pendingToken:pending,name,cls,phone},null);await finishLogin(d.token,d.student)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function completeGoogle(idToken){try{setBusy(true);const d=await request('/api/mobile/auth/google','POST',{idToken},null);if(d.needsProfile){setPending(d.pendingToken);setEmail(d.email);setName(d.name || '');setError('');return}await finishLogin(d.token,d.student)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function finishLogin(studentToken, student) {
    await storage.set('student-token', studentToken);
    setMe(student);
    setSessionNotice('');
    setAuthView('login');
    setPending('');
    editEmail();
    goTo('Home');
    setGuestPage('Welcome');
    setToken(studentToken);
    await refreshDirectory(studentToken);
  }

  async function logout() {
    try {
      await request('/api/auth/logout', 'POST', {}, token);
    } catch {
      // Clear the local session even when the server is unreachable.
    }
    await storage.remove('student-token');
    await clearNativeGoogleSession().catch(() => {});
    setToken(null);
    setMe(null);
    setOrders([]);
    setCart([]);
    orderDraft.current = null;
    setFeedbackMessage('');
    setEmail('');
    setName('');
    setCls('');
    setPhone('');
    setPrintFile(null);
    clearService();
    setQuery('');
    goTo('Home');
    setGuestPage('Welcome');
  }
  async function sendOrder(fingerprint, buildBody, onPlaced, title) {
    if (orderWrite.current) return;
    orderWrite.current = true;
    setSubmittingOrder(true);
    try {
      if (orderDraft.current?.fingerprint !== fingerprint) {
        orderDraft.current = { fingerprint, requestId: randomUUID() };
      }
      const { requestId } = orderDraft.current;
      const body = await buildBody();
      const result = await request('/api/mobile/orders', 'POST', {
        ...body, requestId,
      });
      orderDraft.current = null;
      onPlaced();
      goTo('Orders');
      const { order } = result;
      const fee = order.warningFee ? ` Includes the ${order.warningFee.percent}% missed pickup surcharge.` : '';
      Alert.alert(title, `Pickup token ${order.token} · ${money(order.total)}.${fee}`);
      await refresh().catch(() => {});
    } catch (err) {
      Alert.alert('Could not submit order', err.message);
    } finally {
      orderWrite.current = false;
      setSubmittingOrder(false);
    }
  }

  function placeOrder() {
    const vendorId = selected.id;
    const items = selectedCart.map(({ id, qty }) => ({ id, qty }));
    return sendOrder(JSON.stringify([vendorId, items]), () => ({
      vendorId, items, pickup: 'ASAP',
    }), () => setCart(previous => previous.filter(item => item.vendorId !== vendorId)), 'Order placed');
  }

  async function pickPrintFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.size > MAX_PDF_BYTES) return Alert.alert('PDF is too large', 'Choose a PDF under 10 MB.');
      setPrintFile(asset);
    } catch (err) {
      Alert.alert('File picker unavailable', err.message);
    }
  }

  async function readPrintFile(file) {
    if (Platform.OS !== 'web') {
      return FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    }
    if (!file.file) throw new Error('Select the PDF again.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Couldn’t read the PDF.'));
      reader.readAsDataURL(file.file);
    });
  }

  function submitPrint() {
    if (!printFile) return Alert.alert('Choose a PDF', 'Select the document you want printed.');
    const pages = Number(printPages), copies = Number(printCopies);
    if (!Number.isInteger(pages) || pages < 1 || pages > 999 || !Number.isInteger(copies) || copies < 1 || copies > 50) {
      return Alert.alert('Check print options', 'Choose 1–999 pages and 1–50 copies.');
    }
    const vendorId = selected.id;
    const fingerprint = JSON.stringify([vendorId, printFile.uri, printFile.name, pages, copies]);
    return sendOrder(fingerprint, async () => ({
      vendorId, type: 'print', pickup: 'ASAP',
      print: { pages, copies, color: 'bw', sides: 'single', binding: 'none', fileName: printFile.name },
      file: `data:application/pdf;base64,${await readPrintFile(printFile)}`,
    }), () => setPrintFile(null), 'Print job placed');
  }
  async function cancelOrder(o){Alert.alert('Cancel this order?', 'Repeated cancellations create warnings. Three warnings block ordering. Continue?', [{text:'Keep order',style:'cancel'},{text:'Cancel order',style:'destructive',onPress:async()=>{try{const d=await request(`/api/mobile/orders/${o.id}/cancel`,'PUT',{});await refresh();Alert.alert('Order cancelled',d.strike?.blocked?'Your account has been banned after three warnings.':`Warning ${d.strike?.strikes||''} recorded.`)}catch(e){Alert.alert('Could not cancel',e.message)}}}])}
  async function vendorLogin(credentials) {
    setBusy(true);
    setError('');
    try {
      if (!merchantCode) {
        const result = await request('/api/mobile/vendor/send-code', 'POST', credentials, null, null);
        setMerchantCode({ devCode: result.devCode || '' });
        return;
      }
      const result = await request('/api/mobile/vendor/verify', 'POST', credentials, null, null);
      await storage.set('vendor-token', result.token);
      setVendorToken(result.token);
      setMerchantCode(null);
      await sync(token, result.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function resetMerchantCode() {
    setMerchantCode(null);
    setError('');
  }
  async function vendorRefresh(){try{const d=await request('/api/sync');setShops(normalize(d.vendors));setVendorOrders(normalize(d.vendorOrders));setVendor(d.vendors?.find(x=>x.id===d.vendorId)||vendor)}catch(e){setError(e.message)}}
  async function vendorAssistant(text) {
    const result = await request('/api/mobile/vendor/assistant', 'POST', { text, language }, null, vendorToken);
    if (result.reply) {
      try {
        const speech = await request('/api/mobile/vendor/assistant/speech', 'POST', { text: result.reply, language }, null, vendorToken);
        result.audioBase64 = speech.audioBase64;
      } catch (err) {
        result.speechUnavailable = err.message;
      }
    }
    return result;
  }
  async function confirmAssistantAction(action) {
    if (!action) return;
    const saveShopPatch = async patch => {
      const result = await request('/api/vendor/me', 'PUT', patch);
      setVendor(result.vendor);
      const directory = await request('/api/sync');
      setShops(normalize(directory.vendors));
      return result.vendor;
    };
    if (action.type === 'shop_status') return saveShopPatch({ status: action.status });
    if (action.type === 'queue') return saveShopPatch({ queue: action.queue });
    if (action.type === 'announcement') return saveShopPatch({ note: action.note });
    if (action.type === 'add_menu') {
      const item = { id: `m${Date.now()}`, name: action.name, price: action.price, inStock: true, cat: 'Menu' };
      return saveShopPatch({ menu: [...(vendor?.menu || []), item] });
    }
    if (action.type === 'order_status') {
      const order = vendorOrders.find(item => String(item.token).toLowerCase() === String(action.orderToken).toLowerCase());
      if (!order) return Alert.alert('Order not found', 'Refresh your orders and ask the helper again.');
      return updateOrder(order, action.status);
    }
  }
  async function downloadPrint(order) {
    try {
      const { dataUrl } = await request(`/api/vendor/files/${order.id}`);
      const rawName = order.print?.fileName || 'print-job.pdf';
      const fileName = rawName.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '') || 'print-job.pdf';
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        link.click();
        return;
      }
      const path = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(path, dataUrl.split(',')[1], { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/pdf' });
      } else {
        Alert.alert('Print file saved', path);
      }
    } catch (err) {
      Alert.alert('Could not download print file', err.message);
    }
  }
  async function updateShop(patch){try{const d=await request('/api/vendor/me','PUT',patch);setVendor(d.vendor);setShops(await (async()=>normalize((await request('/api/sync')).vendors))())}catch(e){Alert.alert('Could not save shop',e.message)}}
  async function updateOrder(o,status){try{await request(`/api/mobile/vendor/orders/${o.id}`,'PUT',{status});await vendorRefresh()}catch(e){Alert.alert('Order update failed',e.message)}}
  async function rateOrder(o,stars){try{await request(`/api/orders/${o.id}/rate`,'POST',{stars,comment:''});await refresh();Alert.alert('Thanks for rating',`Your ${stars}-star rating was saved.`)}catch(e){Alert.alert('Could not rate order',e.message)}}
  async function sendFeedback(){try{await request('/api/feedback','POST',{type:'feedback',message:feedbackMessage});setFeedbackMessage('');Alert.alert('Feedback sent','Thank you for helping improve Campus Vendors.')}catch(e){Alert.alert('Could not send feedback',e.message)}}
  async function applyShop() {
    setBusy(true);
    try {
      const result = await request('/api/mobile/vendor-applications', 'POST', form, null, null);
      const message = result.ownerEmailSent
        ? 'The reviewer and shop owner have been emailed. Your shop will appear after approval.'
        : 'The reviewer has been emailed. Your shop will appear after approval.';
      Alert.alert('Application received', message);
      setForm({});
      if (token) goTo('Account');
      else openGuestPage('Welcome');
    } catch (err) {
      Alert.alert('Application failed', err.message);
    } finally {
      setBusy(false);
    }
  }
  function goTo(nextTab) {
    setTab(nextTab);
    setSelected(null);
    setMerchantCode(null);
    setError('');
    setGoogleNotice('');
  }

  function openGuestPage(page) {
    setGuestPage(page);
    setMerchantCode(null);
    setError('');
    setGoogleNotice('');
  }

  const page = restoringSession ? 'Restoring' : token ? tab : guestPage;
  const canGoBack = !!selected || (!token && (page === 'Account' || page === 'Shop'));

  const goBack = useCallback(() => {
    if (busy) return;
    if (selected) {
      setSelected(null);
    } else {
      setGuestPage('Welcome');
      setMerchantCode(null);
      setError('');
      setGoogleNotice('');
    }
  }, [selected, busy]);

  useEffect(() => {
    if (!canGoBack || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack, goBack]);

  function clearService() {
    setService(null);
    setCategory('All');
  }

  function browse(nextService = null) {
    setService(nextService);
    setCategory('All');
    setQuery('');
    goTo('Explore');
  }

  useEffect(() => {
    if (!(page === 'Orders' && token) && !(page === 'Shop' && vendorToken)) return;
    function update() {
      if (Platform.OS !== 'web' && AppState.currentState === 'background') return;
      sync(token, vendorToken).catch(() => {});
    }
    update();
    const timer = setInterval(update, 15_000);
    return () => clearInterval(timer);
  }, [page, token, vendorToken, sync]);

  useEffect(() => {
    if ((!token && !vendorToken) || Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync(token, vendorToken).catch(() => {});
    });
    return () => subscription.remove();
  }, [token, vendorToken, sync]);

  async function startGoogleSignIn() {
    const web = Platform.OS === 'web';
    if (web ? !webGoogleClientId : isRunningInExpoGo() || !nativeGoogleConfigured) {
      setGoogleNotice('Google sign-in is unavailable here. You can sign in with email.');
      return;
    }
    if (web && !googleRequest) {
      setGoogleNotice('Google sign-in is still loading. Try again in a moment.');
      return;
    }
    openGuestPage('Account');
    setAuthView('login');
    editEmail();
    setBusy(true);
    try {
      if (web) {
        await promptGoogle();
      } else {
        const idToken = await signInWithNativeGoogle();
        if (idToken) await completeGoogle(idToken);
      }
    } catch (err) {
      setError(err.message || 'Couldn’t open Google sign-in. Try again or use email.');
    } finally {
      setBusy(false);
    }
  }

  function openShop(shop) {
    setSelected(shop);
    setPrintFile(null);
    setPrintPages('1');
    setPrintCopies('1');
  }

  function editEmail() {
    setCodeSent(false);
    setCode('');
    setDevCode('');
    setError('');
  }

  function toggleAuthView() {
    setAuthView(previous => previous === 'signup' ? 'login' : 'signup');
    editEmail();
  }

  function addItem() {
    const price = Number(itemPrice);
    if (!itemName.trim() || !Number.isFinite(price) || price <= 0) {
      Alert.alert('Check item', 'Enter a name and a price above zero.');
      return;
    }
    const item = { id: `m${Date.now()}`, name: itemName.trim(), price, inStock: true, cat: 'Menu' };
    updateShop({ menu: [...(vendor.menu || []), item] });
    setItemName('');
    setItemPrice('');
  }

  async function signOutOfShop() {
    await request('/api/vendor/logout', 'POST', {}, null, vendorToken).catch(() => {});
    await storage.remove('vendor-token');
    setVendorToken(null);
    setVendor(null);
    setVendorOrders([]);
    setShopNote(null);
  }

  function openPrivacyPage(path) {
    Linking.openURL(`${API}/api/mobile/${path}`).catch(() => Alert.alert('Could not open page', 'Open the privacy page again when you’re online.'));
  }

  return (
    <SafeAreaView style={S.safe}>
      <ExpoStatusBar style="dark" />
      <KeyboardAvoidingView style={S.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.header}>
          {canGoBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel={selected ? 'Back to directory' : 'Back to welcome'} onPress={goBack} disabled={busy} style={S.back}>
              <Icon name="arrow-back" size={22} color={colors.forest} />
            </Pressable>
          ) : (
            <View style={S.brandMark}><Text style={S.brandInitials}>CV</Text></View>
          )}
          <Text style={S.brandName}>{selected ? 'Directory' : 'Campus Vendors'}</Text>
          <View style={S.headerEnd}>
            <Icon name="location-outline" size={16} color={colors.orangeDark} />
            <Text style={S.brandCampus}>RVCE</Text>
          </View>
        </View>

        {page === 'Restoring' ? (
          <ActivityIndicator accessibilityLabel="Restoring session" color={colors.forest} style={S.scroll} />
        ) : page === 'Welcome' ? (
          <Welcome goEmail={() => openGuestPage('Account')} goGoogle={startGoogleSignIn}
            goMerchant={() => openGuestPage('Shop')} googleNotice={googleNotice}
            sessionNotice={sessionNotice} busy={busy} openPrivacy={() => openPrivacyPage('privacy')}
          />
        ) : token && selected ? (
          <ShopDetails
            shop={selected} cart={selectedCart} changeQuantity={changeQuantity}
            warningFeePercent={me?.warningFeePercent} placeOrder={placeOrder} money={money}
            printFile={printFile} printPages={printPages} printCopies={printCopies}
            setPrintPages={setPrintPages} setPrintCopies={setPrintCopies}
            pickPrintFile={pickPrintFile} submitPrint={submitPrint} submittingOrder={submittingOrder}
          />
        ) : page === 'Home' ? (
          <Home me={me} orders={orders} shops={shops} browse={browse} goOrders={() => goTo('Orders')} onBuyAgain={buyAgain} language={language} setLanguage={value => { setLanguage(value); storage.set('app-language', value).catch(() => {}); }} />
        ) : page === 'Explore' ? (
          <Explore
            shops={shops} visible={visible} category={category} categories={categories}
            setCategory={setCategory} query={query} setQuery={setQuery}
            loading={loadingDirectory} error={directoryError} refresh={() => refreshDirectory()}
            onShopPress={openShop} serviceTitle={services[service]?.title} clearService={clearService}
          />
        ) : page === 'Orders' ? (
          <Orders signedIn={!!token} orders={orders} shops={shops} money={money}
            goAccount={() => goTo('Account')} goExplore={() => browse()}
            cancel={cancelOrder} rate={rateOrder}
          />
        ) : page === 'Shop' ? (
          <Merchant
            vendor={vendor} orders={vendorOrders} form={form} setForm={setForm}
            busy={busy} error={error} signIn={vendorLogin} apply={applyShop}
            merchantCode={merchantCode} resetMerchantCode={resetMerchantCode}
            money={money} updateShop={updateShop} shopNote={shopNote} setShopNote={setShopNote}
            itemName={itemName} setItemName={setItemName} itemPrice={itemPrice} setItemPrice={setItemPrice}
            addItem={addItem} updateOrder={updateOrder} downloadPrint={downloadPrint} signOut={signOutOfShop}
            openPrivacy={() => openPrivacyPage('privacy')}
            language={language} askAssistant={vendorAssistant} confirmAssistantAction={confirmAssistantAction}
          />
        ) : (
          <Account
            me={me} signedIn={!!token} authView={authView} pending={pending}
            email={email} code={code} name={name} cls={cls} phone={phone}
            setEmail={setEmail} setCode={setCode} setName={setName} setCls={setCls} setPhone={setPhone}
            codeSent={codeSent} devCode={devCode} busy={busy} error={error || googleNotice}
            toggleAuthView={toggleAuthView} editEmail={editEmail}
            submit={pending ? finishProfile : codeSent ? verifyCode : sendCode} resendCode={sendCode}
            googleSignIn={startGoogleSignIn}
            feedback={feedbackMessage} setFeedback={setFeedbackMessage} sendFeedback={sendFeedback} logout={logout}
            openPrivacy={() => openPrivacyPage('privacy')} deleteAccount={() => openPrivacyPage('delete-account')}
          />
        )}

        {token && <View style={S.nav}>
          {TABS.map(({ label, icon }) => {
            const active = tab === label;
            return (
              <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: active, disabled: submittingOrder }} disabled={submittingOrder} onPress={() => goTo(label)} style={S.navItem}>
                <View style={[S.navIcon, active && S.navIconActive]}>
                  <Icon name={active ? icon : `${icon}-outline`} size={21} color={active ? colors.forest : colors.muted} />
                </View>
                <Text style={[S.navText, active && S.navTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
