# Campus Vendor Directory (DTL EL · RVCE)

A website that connects RVCE students with vendors near campus: tea stalls, print shops, tiffin centres, stationery shops and tailors.
Team: Aarush Sequeira, Atharva Patil, Akshay B, Anjney Rohit Shah · SDG 9 & SDG 17

## Features
- **Live status board**: each shop shows Open / Busy / Closed, people in queue, expected wait, and when it opens or closes
- **Search and filters**: search by shop or item ("dosa", "xerox"), filter by category, show only open shops, sort by wait, distance or rating
- **Menu and prices**: grouped menus, out-of-stock items struck through, timings, call and WhatsApp buttons
- **Food pre-order**: add to cart, choose a pickup time, get a token (e.g. `A-101`), and watch it move Sent → Preparing → Ready → Collected
- **Student cancellations**: first two cancellations add an admin-configurable percentage fee to the next order; a third warning suspends ordering
- **Print job upload**: attach a PDF (pages are counted automatically), pick copies, colour, sides and binding, see a live price estimate, and choose a pickup slot
- **Vendor dashboard**: one-tap status, queue counter, announcement, accept/ready/collected for orders, download print files, edit stock and prices, add items, share status on WhatsApp
- **Merchant applications**: new merchants submit shop details and owner Gmail; the app emails the admin, and the shop stays hidden until approved
- **Admin workspace**: approve/reject applications, adjust warning-fee percentages, and review recent sign-in IPs for possible account sharing
- **Sign-in**: email OTP on every student sign-in, with optional Google sign-in when OAuth is configured
- **Feedback**: students rate a shop after collecting an order
- **QR poster**: a printable poster at `#/poster`
- **₹0 stack**: plain HTML/CSS/JS with no build step, plus Google Sheets as an optional free data layer

## How it's built
**One Render web service** does everything: it serves the website pages and the API (`server/`, Node.js + Express).
Everything it connects to is set with environment variables on that service:
- **Data**: MongoDB Atlas, free M0 cluster (student accounts, shops, menus, orders, print files, feedback, warnings, blocks)
- **Emails**: sign-in codes and merchant-application notices sent through Brevo
- **Admin**: `ADMIN_EMAIL` receives applications and admin OTPs
- **Google sign-in**: optional OAuth 2.0 credentials
- **Code**: https://github.com/atharva1232/Campus-Venders (every push to `main` redeploys)

## Run it on your computer
```bash
cd server
npm install
npm start     # open http://localhost:10000
```
Without `MONGODB_URI` it uses a temporary in-memory MongoDB (downloaded once, ~600 MB), and sign-in codes appear on screen instead of being emailed.

### Render service settings
| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `cd server && npm ci --omit=optional` |
| Start command | `node server/index.js` |

| Environment variable | Value |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (`mongodb+srv://…`) |
| `BREVO_API_KEY` | Brevo API key (SMTP & API → API Keys) |
| `BREVO_SENDER_EMAIL` | `atharvap3212@gmail.com` (a verified sender in Brevo) |
| `ADMIN_EMAIL` | Gmail address that receives merchant applications and admin sign-in codes |
| `PUBLIC_URL` | Public app URL used in approval emails, e.g. `https://campus-vendors.onrender.com` |
| `GOOGLE_CLIENT_ID` | Optional Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Optional Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Optional callback URL ending in `/api/auth/google/callback` |

In MongoDB Atlas → Network Access, allow `0.0.0.0/0` (Render's free plan has no fixed IP address).

## Demo script (for the evaluation)
1. Open the site in **two browser tabs**. Use one as the student and one as an approved vendor.
2. Student: open *Amma's Tiffin Mane*, add a Masala Dosa, then pre-order. A token number appears.
3. Vendor: the order appears under **New**. Tap **Accept**, then **Mark ready**. The student tab updates by itself and shows "Ready!".
4. Vendor: switch the shop to **Busy**, add people to the queue, or mark an item out of stock. The directory updates straight away.
5. Student: on **Print job**, upload a PDF. The page count and price fill in. The print shop's dashboard gets the file to download.
6. **Reset demo** in the footer restores the sample data.

> Demo data is saved in the browser (localStorage), so both tabs must be in the same browser. A real deployment would put orders in a shared database.

### Google OAuth setup

Create an OAuth client in Google Cloud Console. Add the app's public origin as an authorized JavaScript origin and `/api/auth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and (if needed) `GOOGLE_REDIRECT_URI` on the server. Google sign-in only accepts verified Gmail accounts. New students finish their profile before ordering.

### Warning policy

The first two student cancellations (or confirmed missed pickups) create a warning and attach the configured percentage to the next order total. Checkout shows the server-calculated fee; it is paid to the merchant at pickup. A third warning suspends ordering for that Gmail account. Admins can edit the percentages from `#/admin`. The app records the sign-in IP and user agent for 90 days; an IP shared by multiple accounts is a review signal, not proof that the accounts belong to one person.

## Hosting free (GitHub Pages)
```bash
git init && git add . && git commit -m "Campus Vendor Directory"
git branch -M main
git remote add origin https://github.com/<your-username>/campus-vendors.git
git push -u origin main
```
On GitHub, go to Settings → Pages → Deploy from branch → `main` / root. Netlify Drop and Vercel also work: drag the folder in.

## Going live with Google Sheets
1. Create a Google Sheet with two tabs. Import `sheets/vendors.csv` into one and `sheets/menu.csv` into the other.
2. File → Share → **Publish to web**. Publish each tab as **CSV** and copy both links.
3. Paste the links into `js/config.js` (`SHEET_VENDORS_CSV`, `SHEET_MENU_CSV`).
4. Vendors (or your team, after a WhatsApp message) edit `status`, `queue`, `note` or `in_stock` in the Sheet. The site re-reads it every 60 seconds.

Column notes: `status` = open / busy / closed · `hours` = `07:00-10:30;12:00-15:00` · `in_stock` = yes / no · add `print_bw` and `print_color` (₹ per page) to turn on print jobs for a shop.

In Sheets mode the Sheet is the source of truth. Dashboard edits only stay until the next refresh.

## Files
```
index.html        page shell
css/style.css     styles (mobile-first)
js/config.js      settings: Sheets links, demo PIN
js/data.js        sample vendors
js/store.js       saved state + Google Sheets loader
js/app.js         all pages and routing
sheets/*.csv      templates for Google Sheets
```

## Known limits (worth mentioning in the Test phase)
- Merchant login still uses shop name, pincode and registered phone; student accounts use emailed OTP or configured Google OAuth.
- Files over about 3 MB can't be kept in demo storage. The order still goes through, but the vendor can't download the file.
- Vendors are sample data. Replace them with the real shops from your survey mapping.
