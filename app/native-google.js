import { Platform } from 'react-native';

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
export const nativeGoogleConfigured = !!webClientId && (Platform.OS !== 'ios' || !!iosClientId);
let googleSignin;

export async function signInWithNativeGoogle() {
  // Expo Go cannot load this native module. Only load it once a standalone build tries to sign in.
  const { GoogleSignin, isSuccessResponse, statusCodes } = require('@react-native-google-signin/google-signin');
  if (!googleSignin) {
    GoogleSignin.configure({ webClientId, ...(iosClientId ? { iosClientId } : {}) });
    googleSignin = GoogleSignin;
  }
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Clear this app's cached Google account so the native flow offers the device account picker.
    await GoogleSignin.signOut();
    const result = await GoogleSignin.signIn();
    if (!isSuccessResponse(result)) return null;
    if (!result.data.idToken) throw new Error('Google did not return an ID token. Try signing in with email.');
    return result.data.idToken;
  } catch (err) {
    if (err.code === statusCodes.SIGN_IN_CANCELLED) return null;
    if (err.code === statusCodes.IN_PROGRESS) return null;
    if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play services is unavailable. Sign in with email or update Google Play services.');
    }
    throw new Error('Couldn’t complete Google sign-in. Try again or use email.');
  }
}

export async function clearNativeGoogleSession() {
  if (googleSignin) await googleSignin.signOut();
}
