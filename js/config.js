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
  // Campus Vendors API (Render web service + Render Postgres; emails through Brevo).
  // The API serves this website too, so normally it's the same address ("").
  // Only when the pages come from somewhere else does the site need the API's full address.
  API_URL: location.port === "8000" ? "http://localhost:10000"                                  // python serve.py
    : location.hostname === "campus-vendors.onrender.com" ? "https://campus-vendors-api.onrender.com" // old static site
    : "",
};
