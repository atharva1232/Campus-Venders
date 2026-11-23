/*
 * Campus Vendor Directory — configuration
 *
 * Leave the two CSV links empty to run on the built-in demo data.
 * To go live with Google Sheets (₹0 data layer):
 *   1. Import sheets/vendors.csv and sheets/menu.csv into one Google Sheet (two tabs).
 *   2. File → Share → Publish to web → choose each tab → "Comma-separated values (.csv)".
 *   3. Paste the two links below and reload the page.
 */
window.CVD_CONFIG = {
  SHEET_VENDORS_CSV: "",
  SHEET_MENU_CSV: "",
  REFRESH_SECONDS: 60,      // how often to re-read the sheet
  CAMPUS_PINCODE: "560059", // postal pincode for shops listed without one (vendors log in with shop name + pincode + phone)
  CAMPUS_NAME: "RVCE",
  // The server that serves this website is also its API, so it lives at the same address ("").
  // Only `python serve.py` (port 8000) needs the local server's full address.
  API_URL: location.port === "8000" ? "http://localhost:10000" : "",
};
