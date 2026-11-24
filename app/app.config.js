module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosClientId?.endsWith('.apps.googleusercontent.com')) return config;

  const id = iosClientId.replace('.apps.googleusercontent.com', '');
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      ['@react-native-google-signin/google-signin', { iosUrlScheme: `com.googleusercontent.apps.${id}` }],
    ],
  };
};
