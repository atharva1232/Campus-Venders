import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Explore, ShopDetails } from './directory';
import { Account, Merchant, Orders } from './flows';
import { Icon, colors, styles as S } from './ui';
import * as SecureStore from 'expo-secure-store';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

WebBrowser.maybeCompleteAuthSession();
const API = process.env.EXPO_PUBLIC_API_URL || 'https://campus-vendors-mobile-api.onrender.com';
const HERO_IMAGE = require('./assets/campus-food.jpg');
const TABS = [
  { label: 'Explore', icon: 'compass' },
  { label: 'Orders', icon: 'receipt' },
  { label: 'Shop', icon: 'storefront' },
  { label: 'Account', icon: 'person' },
];
const money = n => `₹${Math.round(Number(n)||0)}`;
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
  const [token,setToken]=useState(null), [me,setMe]=useState(null), [shops,setShops]=useState([]), [orders,setOrders]=useState([]), [cart,setCart]=useState([]), [tab,setTab]=useState('Explore');
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [authView,setAuthView]=useState('login'), [codeSent,setCodeSent]=useState(false), [devCode,setDevCode]=useState(''), [pending,setPending]=useState('');
  const [email,setEmail]=useState(''), [code,setCode]=useState(''), [name,setName]=useState(''), [cls,setCls]=useState(''), [phone,setPhone]=useState(''), [query,setQuery]=useState(''), [category,setCategory]=useState('All'), [selected,setSelected]=useState(null), [vendorToken,setVendorToken]=useState(null), [vendor,setVendor]=useState(null), [vendorOrders,setVendorOrders]=useState([]);
  const [form,setForm]=useState({}), [itemName,setItemName]=useState(''), [itemPrice,setItemPrice]=useState(''), [shopNote,setShopNote]=useState(null), [printFile,setPrintFile]=useState(null), [printPages,setPrintPages]=useState('1'), [printCopies,setPrintCopies]=useState('1'), [feedbackMessage,setFeedbackMessage]=useState('');
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const googleEnabled = !!Platform.select({
    android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
  const [googleRequest,googleResponse,promptGoogle]=Google.useAuthRequest({androidClientId:process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID||'preview-disabled.apps.googleusercontent.com',iosClientId:process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID||'preview-disabled.apps.googleusercontent.com',webClientId:process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID||'preview-disabled.apps.googleusercontent.com',responseType:'id_token',scopes:['openid','profile','email']});
  const request=useCallback(async(path,method='GET',body=null,auth=token,shopToken=vendorToken)=>{
    const headers={'content-type':'application/json'}; if(auth) headers.authorization=`Bearer ${auth}`; if(shopToken)headers['x-vendor-token']=shopToken;
    let response; try { response=await fetch(`${API}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{})}); } catch { throw new Error('Network unavailable. Check your connection and try again.'); }
    const data=await response.json().catch(()=>({})); if(!response.ok)throw new Error(data.error||'Request failed.'); return data;
  },[token,vendorToken]);
  const sync = useCallback(async (studentToken, merchantToken) => {
    const data = await request('/api/sync', 'GET', null, studentToken, merchantToken);
    const nextShops = normalize(data.vendors);
    setShops(nextShops);
    setMe(data.me || null);
    setOrders(normalize(data.myOrders));
    if (merchantToken && data.vendorId) {
      setVendor(nextShops.find(shop => shop.id === data.vendorId) || { id: data.vendorId });
      setVendorOrders(normalize(data.vendorOrders));
    }
  }, [request]);

  const refresh = (studentToken = token) => sync(studentToken, vendorToken);
  async function refreshDirectory() {
    setLoadingDirectory(true);
    setDirectoryError('');
    try {
      await refresh();
    } catch (err) {
      setDirectoryError(err.message);
    } finally {
      setLoadingDirectory(false);
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const [savedStudent, savedMerchant] = await Promise.all([
          storage.get('student-token'),
          storage.get('vendor-token'),
        ]);
        setToken(savedStudent);
        setVendorToken(savedMerchant);
        await sync(savedStudent, savedMerchant);
      } catch (err) {
        setDirectoryError(err.message);
      } finally {
        setLoadingDirectory(false);
      }
    }
    load();
  }, []);

  useEffect(()=>{if(googleResponse?.type==='success'){const idToken=googleResponse.authentication?.idToken||googleResponse.params?.id_token;if(idToken)completeGoogle(idToken);else setError('Google did not return a verified ID token.')}} ,[googleResponse]);
  const categories=useMemo(()=>['All',...new Set(shops.map(s=>s.category).filter(Boolean))],[shops]);
  const search = query.trim().toLowerCase();
  const visible = shops.filter(shop => {
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
  async function sendCode(){try{setBusy(true);const d=await request('/api/auth/send-code','POST',{email:email.trim().toLowerCase(),...(authView==='signup'?{details:{name,cls,phone}}:{})},null);setDevCode(d.devCode||'');setCodeSent(true);setError('');}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function verifyCode(){try{setBusy(true);const d=await request('/api/mobile/auth/verify','POST',{email:email.trim().toLowerCase(),code},null);if(d.needsProfile){setPending(d.pendingToken);setError('Add your name, class and mobile number to finish creating your account.');return}await finishLogin(d.token,d.student)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function finishProfile(){try{setBusy(true);const d=await request('/api/mobile/auth/finish','POST',{pendingToken:pending,name,cls,phone},null);await finishLogin(d.token,d.student)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function completeGoogle(idToken){try{setBusy(true);const d=await request('/api/mobile/auth/google','POST',{idToken},null);if(d.needsProfile){setPending(d.pendingToken);setEmail(d.email);setError('Finish your profile to continue.');return}await finishLogin(d.token,d.student)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function finishLogin(t,student){await storage.set('student-token',t);setToken(t);setMe(student);setAuthView('login');setCodeSent(false);setPending('');setError('');await refresh(t)}
  async function logout(){try{await request('/api/auth/logout','POST',{},token)}catch{}await storage.remove('student-token');setToken(null);setMe(null);setOrders([]);setTab('Explore')}
  async function placeOrder(){if(!token){goTo('Account');setError('Sign in with your email code to place an order.');return}const items=selectedCart;try{const d=await request('/api/mobile/orders','POST',{vendorId:selected.id,items:items.map(x=>({id:x.id,qty:x.qty})),pickup:'ASAP',note:''});setCart(previous=>previous.filter(item=>item.vendorId!==selected.id));setSelected(null);await refresh();Alert.alert('Order placed',`Your pickup token is ${d.order.token}. Total: ${money(d.order.total)}${d.order.warningFee?` (includes ${d.order.warningFee.percent}% warning fee for the shop)`:''}`)}catch(e){Alert.alert('Could not place order',e.message)}}
  async function pickPrintFile(){try{const r=await DocumentPicker.getDocumentAsync({type:'application/pdf',copyToCacheDirectory:true});if(!r.canceled)setPrintFile(r.assets[0])}catch(e){Alert.alert('File picker unavailable',e.message)}}
  async function submitPrint(){if(!token){goTo('Account');setError('Sign in with your email code to submit a print job.');return}if(!printFile)return Alert.alert('Choose a PDF','Select the document you want printed.');try{const base64=await FileSystem.readAsStringAsync(printFile.uri,{encoding:FileSystem.EncodingType.Base64});const d=await request('/api/mobile/orders','POST',{vendorId:selected.id,type:'print',pickup:'ASAP',print:{pages:Number(printPages)||1,copies:Number(printCopies)||1,color:'bw',sides:'single',binding:'none',fileName:printFile.name,size:printFile.size||0},file:`data:application/pdf;base64,${base64}`});setPrintFile(null);setSelected(null);await refresh();Alert.alert('Print job placed',`Pickup token ${d.order.token} · ${money(d.order.total)}`)}catch(e){Alert.alert('Could not place print job',e.message)}}
  async function cancelOrder(o){Alert.alert('Cancel this order?', 'Repeated cancellations create warnings. Three warnings block ordering. Continue?', [{text:'Keep order',style:'cancel'},{text:'Cancel order',style:'destructive',onPress:async()=>{try{const d=await request(`/api/mobile/orders/${o.id}/cancel`,'PUT',{});await refresh();Alert.alert('Order cancelled',d.strike?.blocked?'Your account has been banned after three warnings.':`Warning ${d.strike?.strikes||''} recorded.`)}catch(e){Alert.alert('Could not cancel',e.message)}}}])}
  async function vendorLogin(credentials){try{setBusy(true);const d=await request('/api/vendor/login','POST',credentials,null,null);await storage.set('vendor-token',d.token);setVendorToken(d.token);await sync(token,d.token);setError('')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function vendorRefresh(){try{const d=await request('/api/sync');setShops(normalize(d.vendors));setVendorOrders(normalize(d.vendorOrders));setVendor(d.vendors?.find(x=>x.id===d.vendorId)||vendor)}catch(e){setError(e.message)}}
  async function downloadPrint(o){try{const d=await request(`/api/vendor/files/${o.id}`);const b64=d.dataUrl.split(',')[1];const path=`${FileSystem.cacheDirectory}${o.print?.fileName||'print-job.pdf'}`;await FileSystem.writeAsStringAsync(path,b64,{encoding:FileSystem.EncodingType.Base64});if(await Sharing.isAvailableAsync())await Sharing.shareAsync(path,{mimeType:'application/pdf'});else Alert.alert('Print file saved',path)}catch(e){Alert.alert('Could not download print file',e.message)}}
  async function updateShop(patch){try{const d=await request('/api/vendor/me','PUT',patch);setVendor(d.vendor);setShops(await (async()=>normalize((await request('/api/sync')).vendors))())}catch(e){Alert.alert('Could not save shop',e.message)}}
  async function updateOrder(o,status){try{await request(`/api/mobile/vendor/orders/${o.id}`,'PUT',{status});await vendorRefresh()}catch(e){Alert.alert('Order update failed',e.message)}}
  async function rateOrder(o,stars){try{await request(`/api/orders/${o.id}/rate`,'POST',{stars,comment:''});await refresh();Alert.alert('Thanks for rating',`Your ${stars}-star rating was saved.`)}catch(e){Alert.alert('Could not rate order',e.message)}}
  async function sendFeedback(){try{await request('/api/feedback','POST',{type:'feedback',message:feedbackMessage});setFeedbackMessage('');Alert.alert('Feedback sent','Thank you for helping improve Campus Vendors.')}catch(e){Alert.alert('Could not send feedback',e.message)}}
  async function applyShop(){try{setBusy(true);const d=await request('/api/mobile/vendor-applications','POST',form,null,null);Alert.alert('Application received',d.reviewEmailSent?'The review email was sent. Your shop will appear after approval.':`Saved, but the review email could not be sent. Ask the app operator to check ADMIN_EMAIL and Brevo settings. ${d.ownerEmailSent?'A receipt was emailed to the owner.':''}`);setTab('Account')}catch(e){Alert.alert('Application failed',e.message)}finally{setBusy(false)}}
  function goTo(nextTab) {
    setTab(nextTab);
    setSelected(null);
    setError('');
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
    await storage.remove('vendor-token');
    setVendorToken(null);
    setVendor(null);
    setVendorOrders([]);
    setShopNote(null);
  }

  return (
    <SafeAreaView style={S.safe}>
      <ExpoStatusBar style="dark" />
      <KeyboardAvoidingView style={S.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.header}>
          {selected ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back to directory" onPress={() => setSelected(null)} style={S.back}>
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

        {selected ? (
          <ShopDetails
            shop={selected} cart={selectedCart} changeQuantity={changeQuantity}
            warningFeePercent={me?.warningFeePercent} placeOrder={placeOrder} money={money}
            printFile={printFile} printPages={printPages} printCopies={printCopies}
            setPrintPages={setPrintPages} setPrintCopies={setPrintCopies}
            pickPrintFile={pickPrintFile} submitPrint={submitPrint}
          />
        ) : tab === 'Explore' ? (
          <Explore
            shops={shops} visible={visible} category={category} categories={categories}
            setCategory={setCategory} query={query} setQuery={setQuery}
            loading={loadingDirectory} error={directoryError} refresh={refreshDirectory}
            onShopPress={openShop} heroImage={HERO_IMAGE}
          />
        ) : tab === 'Orders' ? (
          <Orders signedIn={!!token} orders={orders} shops={shops} money={money}
            goAccount={() => goTo('Account')} goExplore={() => goTo('Explore')}
            cancel={cancelOrder} rate={rateOrder}
          />
        ) : tab === 'Shop' ? (
          <Merchant
            vendor={vendor} orders={vendorOrders} form={form} setForm={setForm}
            busy={busy} error={error} signIn={vendorLogin} apply={applyShop}
            money={money} updateShop={updateShop} shopNote={shopNote} setShopNote={setShopNote}
            itemName={itemName} setItemName={setItemName} itemPrice={itemPrice} setItemPrice={setItemPrice}
            addItem={addItem} updateOrder={updateOrder} downloadPrint={downloadPrint} signOut={signOutOfShop}
          />
        ) : (
          <Account
            me={me} signedIn={!!token} authView={authView} pending={pending}
            email={email} code={code} name={name} cls={cls} phone={phone}
            setEmail={setEmail} setCode={setCode} setName={setName} setCls={setCls} setPhone={setPhone}
            codeSent={codeSent} devCode={devCode} busy={busy} error={error}
            toggleAuthView={toggleAuthView} editEmail={editEmail}
            submit={pending ? finishProfile : codeSent ? verifyCode : sendCode}
            googleSignIn={googleEnabled && googleRequest ? () => promptGoogle() : undefined}
            feedback={feedbackMessage} setFeedback={setFeedbackMessage} sendFeedback={sendFeedback} logout={logout}
          />
        )}

        <View style={S.nav}>
          {TABS.map(({ label, icon }) => {
            const active = tab === label;
            return (
              <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => goTo(label)} style={S.navItem}>
                <View style={[S.navIcon, active && S.navIconActive]}>
                  <Icon name={active ? icon : `${icon}-outline`} size={21} color={active ? colors.forest : colors.muted} />
                </View>
                <Text style={[S.navText, active && S.navTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
