# Campus Vendor Directory (DTL EL · RVCE)

A website that connects RVCE students with vendors near campus: tea stalls, print shops, tiffin centres, stationery shops and tailors.
Team: Aarush Sequeira, Atharva Patil, Akshay B, Anjney Rohit Shah · SDG 9 & SDG 17

## Features
- **Live status board**: each shop shows Open / Busy / Closed, people in queue, expected wait, and when it opens or closes
- **Search and filters**: search by shop or item ("dosa", "xerox"), filter by category, show only open shops, sort by wait, distance or rating
- **Menu and prices**: grouped menus, out-of-stock items struck through, timings, call and WhatsApp buttons
- **Food pre-order**: add to cart, choose a pickup time, get a token (e.g. `A-101`), and watch it move Sent → Preparing → Ready → Collected
- **Print job upload**: attach a PDF (pages are counted automatically), pick copies, colour, sides and binding, see a live price estimate, and choose a pickup slot
- **Vendor dashboard**: one-tap status, queue counter, announcement, accept/ready/collected for orders, download print files, edit stock and prices, add items, share status on WhatsApp
- **Feedback**: students rate a shop after collecting an order
- **QR poster**: a printable poster at `#/poster`
- **₹0 stack**: plain HTML/CSS/JS with no build step, plus Google Sheets as an optional free data layer

## How it's built
One Render web service plus one database:
- **`campus-vendors-api`** (Node.js + Express, `server/`): serves the website pages **and** the API, at https://campus-vendors-api.onrender.com
- **`campus-vendors-db`** (Render Postgres): student accounts, shops, menus, orders, print files, feedback, warnings and blocks
- **Emails**: 6-digit sign-in codes are sent through Brevo from atharvap3212@gmail.com
- **Code**: https://github.com/atharva1232/Campus-Venders (every push to `main` redeploys)

## Run it on your computer
```bash
cd server
npm install
npm start            # open http://localhost:10000 (temporary in-memory database; sign-in codes appear on screen)
```

### Render settings (service `campus-vendors-api` → Environment)
| Variable | Value |
|---|---|
| `DATABASE_URL` | the Postgres **Internal Database URL** |
| `BREVO_API_KEY` | a Brevo **API key** (SMTP & API → API Keys) |
| `SENDER_EMAIL` or `BREVO_SENDER_EMAIL` | `atharvap3212@gmail.com` (a verified sender in Brevo) |

## Demo script (for the evaluation)
1. Open the site in **two browser tabs**. Use one as the student and one as the vendor (**For vendors**, demo PIN `1234`).
2. Student: open *Amma's Tiffin Mane*, add a Masala Dosa, then pre-order. A token number appears.
3. Vendor: the order appears under **New**. Tap **Accept**, then **Mark ready**. The student tab updates by itself and shows "Ready!".
4. Vendor: switch the shop to **Busy**, add people to the queue, or mark an item out of stock. The directory updates straight away.
5. Student: on **Print job**, upload a PDF. The page count and price fill in. The print shop's dashboard gets the file to download.
6. **Reset demo** in the footer restores the sample data.

> Demo data is saved in the browser (localStorage), so both tabs must be in the same browser. A real deployment would put orders in a shared database.

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
- The vendor PIN is for the demo only. Real login would need a backend (e.g. Firebase or Supabase).
- Files over about 3 MB can't be kept in demo storage. The order still goes through, but the vendor can't download the file.
- Vendors are sample data. Replace them with the real shops from your survey mapping.
