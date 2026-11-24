/* Database: MongoDB.
   On Render: MongoDB Atlas (free M0), connected with the MONGODB_URI environment variable.
   On your computer without MONGODB_URI: a temporary in-memory MongoDB (wiped when the server stops). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { MongoClient } = require("mongodb");

const col = {}; // students, blockedEmails, loginCodes, OAuth state, login events, sessions, vendors, applications, orders, feedback
let kind = "";

async function connect() {
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    if (process.env.RENDER) {
      // on Render, never fall back to a throwaway database
      throw new Error("MONGODB_URI is not set. In Render: your service → Environment → add MONGODB_URI = the MongoDB Atlas connection string.");
    }
    const { MongoMemoryServer } = require("mongodb-memory-server");
    // MongoDB has no Windows-on-ARM build; Windows runs the x64 one through emulation
    const arch = process.platform === "win32" && process.arch === "arm64" ? "x64" : undefined;
    const mem = await MongoMemoryServer.create(arch ? { binary: { arch } } : undefined);
    uri = mem.getUri();
    kind = "in-memory MongoDB (temporary)";
  } else kind = "MongoDB Atlas";

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "campus_vendors");
  for (const [k, name] of Object.entries({
    students: "students", blockedEmails: "blocked_emails", loginCodes: "login_codes", oauthStates: "oauth_states", loginEvents: "login_events", sessions: "sessions",
    vendors: "vendors", vendorApplications: "vendor_applications", orders: "orders", printFiles: "print_files", noShows: "no_shows", feedback: "feedback", counters: "counters",
  })) col[k] = db.collection(name);

  await col.students.createIndex({ email: 1 }, { unique: true });
  await col.vendors.createIndex({ nameKey: 1 }, { unique: true });
  await col.vendorApplications.createIndex({ status: 1, createdAt: -1 });
  await col.orders.createIndex({ vendorId: 1, createdAt: -1 });
  await col.orders.createIndex({ studentId: 1, createdAt: -1 });
  await col.noShows.createIndex({ studentId: 1 });
  await col.feedback.createIndex({ vendorId: 1 });
  await col.feedback.createIndex({ studentId: 1 });
  // MongoDB deletes expired codes and sessions by itself
  await col.loginCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await col.oauthStates.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await col.loginEvents.createIndex({ createdAt: -1 });
  await col.loginEvents.createIndex({ ip: 1, createdAt: -1 });
  await col.loginEvents.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await col.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  await seed();
  return col;
}

/* next number in a running sequence (order tokens, feedback references) */
async function nextSeq(name, start) {
  const r = await col.counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return start - 1 + r.seq;
}

const nameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Load the shop list from the website's own js/data.js (one source of truth),
   and add any shop that isn't in the database yet. */
async function seed() {
  const sandbox = { window: { SEED_VENDORS: [] } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"), sandbox);
  for (const v of sandbox.window.SEED_VENDORS) {
    await col.vendors.updateOne(
      { _id: v.id },
      { $setOnInsert: { _id: v.id, nameKey: nameKey(v.name), pincode: String(v.pincode || "560059"), phone: String(v.phone || ""),
        data: { ...v, ratings: [], updatedAt: Date.now() }, createdAt: new Date() } },
      { upsert: true }
    );
  }
}

module.exports = { connect, col, nextSeq, nameKey, get kind() { return kind; } };
