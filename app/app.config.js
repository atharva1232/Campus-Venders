module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const id = iosClientId?.endsWith('.apps.googleusercontent.com')
    ? iosClientId.replace('.apps.googleusercontent.com', '')
    : null;
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      ['expo-speech-recognition', {
        microphonePermission: 'Campus Vendors uses the microphone so merchants can manage shop tasks by voice.',
        speechRecognitionPermission: 'Campus Vendors converts your speech into a shop task.',
      }],
      ...(id ? [['@react-native-google-signin/google-signin', { iosUrlScheme: `com.googleusercontent.apps.${id}` }]] : []),
    ],
  };
};
