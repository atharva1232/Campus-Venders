# Campus Vendors mobile app

Standalone Expo app for Android and iOS. Website pages and styles are unchanged. The server adds mobile API routes while preserving the existing website routes and their behavior.

## Run locally

```sh
npm install
npm start
```

Scan the Expo QR code with Expo Go, or press `a` / `i` to launch a simulator. Configure these Expo environment variables before building:

- `EXPO_PUBLIC_API_URL`: API origin (defaults to `https://campus-vendors-mobile-api.onrender.com`)
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`: optional Google OAuth client IDs

The API code in this branch must be deployed before the app can use the new `/api/mobile` routes. To keep the existing website deployment untouched, create a separate Render Blueprint from branch `app-dev`, using the root `render.yaml`. It creates the `campus-vendors-mobile-api` web service. Add the existing website service's `MONGODB_URI` and Brevo API key, and set `ADMIN_EMAIL` to the Gmail inbox that reviews shop applications. The service uses the same `campus_vendors` database. After Render assigns the service URL, set `EXPO_PUBLIC_API_URL` in EAS to that URL and rebuild the APK. For Google sign-in, configure matching Google client IDs on both the mobile API and EAS build environment. Shop applications are reviewed from one-time email links; there is no admin page in the app.

The mobile API supports OTP and optional Google sign-in, shop browsing, food orders, PDF print orders, order tracking/cancellation, ratings, feedback, merchant applications and email review, shop operations, queue/menu updates, and order processing. The first two cancellation or missed-pickup warnings add 5% then 10% to the student's next order for the merchant; a third blocks ordering and emails the student. Successful mobile sign-ins record IPs for 90 days. An IP match to a banned account can block another account and email its owner; shared campus Wi-Fi can cause false matches.

## Store builds

Install EAS CLI, log in to the Expo account, then run `eas build --platform android` or `eas build --platform ios` from this folder. Store release still requires the owner's Expo, Google Play, and Apple Developer accounts, signing credentials, store metadata, and privacy disclosures.

## Theme

Forest green `#16302a`, warm orange `#e2672b`, and cream `#f5f0e6` match the website.
