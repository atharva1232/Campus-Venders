# Campus Vendors mobile app

Expo app for Android and iOS. The welcome screen introduces the services. Students reach the directory, ordering, and account screens after signing in. Merchants can apply to register a shop and sign in with a code sent to the approved owner's Gmail.

## Local preview

Start the API from the repository root.

```sh
npm ci --prefix server
MOBILE_ONLY=1 MOBILE_SEED_DEMO=1 ADMIN_EMAIL=reviewer@example.invalid node server/index.js
```

The local service uses a temporary MongoDB replica set unless you set `MONGODB_URI`. Without a Brevo key, it prints emails to the console and returns development codes. On Ubuntu distributions newer than the ones MongoDB provides binaries for, set `MONGOMS_DISTRO=ubuntu-22.04`.

From the `app` directory, install packages and start the emulator preview.

```sh
npm ci
EXPO_PUBLIC_API_URL=http://10.0.2.2:10000 npx expo start --go --android
```

Expo Go supports the email code flow. Use a signed development or internal Android build to test native Google sign-in. Demo shops are available for browsing in development. Apply for and approve a local test shop to try merchant OTP and order processing.

## Deploy the mobile API

Create a separate Render Blueprint from `app-dev` using the root `render.yaml`. It defines the mobile service. Use a dedicated MongoDB database and a database user with access to that database. Production starts with an empty directory so new shops can be verified through the approval email before they receive orders.

Set the following in the mobile service's Render environment.

| Variable | Value |
|---|---|
| `MONGODB_URI` | Atlas replica set connection string for the mobile database user |
| `MONGODB_DB` | `campus_vendors_mobile` |
| `BREVO_API_KEY` | Transactional email key |
| `BREVO_SENDER_EMAIL` | Verified Brevo sender |
| `ADMIN_EMAIL` | Gmail address that reviews new shops and receives account alerts |
| `GOOGLE_CLIENT_ID` | Google OAuth **web** client ID, used to verify ID tokens |
| `SUPPORT_EMAIL` | Optional privacy contact. Defaults to the review inbox. |
| `ALLOWED_ORIGINS` | Optional comma-separated browser preview origins. Native apps do not need this. |

The Blueprint generates `MOBILE_AUTH_SECRET`. Keep it stable across releases. It protects email codes, IP identifiers, and ban identifiers. `MOBILE_ONLY=1` enables mobile release routing. Keep the website service pointed at its existing branch and database.

Check `/api/mobile/health` after deployment. The health response confirms connectivity and configuration presence. Confirm email delivery and Google sign-in separately with real accounts before release. The free Render service can suspend while idle, so select an always-on service for the production launch.

## Configure Google and build

1. Create a Google OAuth **web** client ID. Set it as `GOOGLE_CLIENT_ID` on Render and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the applicable EAS environment. This client ID is public. The app does not need a Google OAuth client secret.
2. In the same Google Cloud project, create Android OAuth clients for package `com.campusvendors.mobile` and the SHA-1 signing fingerprints used by the EAS internal build and Google Play App Signing. Each signing certificate needs a matching Android client.
3. For an iOS build, create an iOS OAuth client for bundle ID `com.campusvendors.mobile` and set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. The Expo config adds the matching URL scheme.
4. Set `EXPO_PUBLIC_API_URL` to the mobile service's HTTPS origin for the relevant EAS environments. Build an internal APK with `eas build --platform android --profile preview`. Use `eas build --platform android --profile production` for a Play App Bundle.
5. Verify a real student OTP, a real Google account, merchant application delivery and owner OTP, and a food and PDF order with approved test shops. Use the signing certificate that matches the build you are verifying.

See the [Google Sign-In setup guide](https://react-native-google-signin.github.io/docs/setting-up/expo) for native configuration.

The current EAS internal Android signing certificate has SHA-1 `65:63:4A:30:7D:17:14:52:FB:6F:8A:CA:63:41:B7:C5:1F:22:DE:B7`. Recheck with `eas credentials --platform android` if it changes. Google Play App Signing has its own fingerprint.

## Release policies

- A cancellation counts toward the three-warning ban and does not add a surcharge. The first and second missed pickups add 5% and 10% to an order, respectively. The app shows the fee before purchase, and it goes to the shop.
- Sign-in IP matches trigger a review email. Shared campus Wi-Fi does not automatically ban another account.
- The mobile service hosts the privacy page at `/api/mobile/privacy` and the verified student account deletion form at `/api/mobile/delete-account`. Review these pages, confirm the support inbox is monitored, and use the deployed HTTPS links for the store listing and data safety forms.
