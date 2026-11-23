/* Shops near RVCE. */
window.SEED_VENDORS = [];

/* Shops near RVCE added by the team. Timings, distances and prices are placeholders:
   each vendor can correct them and add their menu from the "For vendors" dashboard. */
(function () {
  const PRINT = { bw: 2, color: 10, doubleSidedDiscount: 0.2, binding: 30 };
  const shop = (id, name, category, emoji, location, distance, extra) => ({
    id, name, category, emoji, status: "open", queue: 0, avgServe: 2,
    hours: [["08:00", "20:00"]], phone: "", whatsapp: "",
    location, distance, pincode: "560059", note: "", menu: [], ...(extra || {}),
  });
  window.SEED_VENDORS.push(
    // Food
    shop("main-mingos", "Main Mingos", "Food", "🍛", "Mingos, RVCE campus", 50),
    shop("mm-food", "MM Food", "Food", "🍱", "Near campus", 150),
    // Snacks
    shop("cafe-mingos", "Café Mingos", "Snacks", "☕", "Mingos, RVCE campus", 50),
    shop("mini-mingos", "Mini Mingos", "Snacks", "🥪", "Mingos, RVCE campus", 50),
    // Print
    shop("mingos-printout", "Mingos Printout", "Print & Xerox", "🖨️", "Mingos, RVCE campus", 50, { print: { ...PRINT } }),
    shop("main-gate-printout", "Main Gate Printout", "Print & Xerox", "📄", "Main Gate", 100, { print: { ...PRINT } }),
    // Shops
    shop("mingos-shops", "Mingos Shops", "Shops", "🏪", "Mingos, RVCE campus", 50),
    shop("main-gate-shop-1", "Main Gate Shop 1", "Shops", "🏪", "Main Gate", 100),
    shop("main-gate-shop-2", "Main Gate Shop 2", "Shops", "🏪", "Main Gate", 100),
    shop("back-gate-shop-3", "Back Gate Shop 3", "Shops", "🏪", "Back Gate", 300),
    // Stationery
    shop("mingos-stationery", "Mingos Stationery", "Stationery", "✏️", "Mingos, RVCE campus", 50),
    // Juice & Chats
    shop("back-gate-juice", "Back Gate Juice Shop", "Juice & Chats", "🥤", "Back Gate", 300),
    // Tailor
    shop("back-gate-tailor", "Back Gate Tailor", "Tailor", "🧵", "Back Gate", 300),
  );
})();
