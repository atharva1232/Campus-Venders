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
  // Student login (Gmail + emailed code). Public publishable key: safe to ship in the page.
  SUPABASE_URL: "https://lfwnnuhplzafpoqibemd.supabase.co",
  SUPABASE_KEY: "sb_publishable_SOLBGNpna_GKNIx5c6CUFA_rl6qZHaL",
};
