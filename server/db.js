/* Database: Render Postgres in production (DATABASE_URL), or an in-memory
   Postgres (PGlite) for local development and tests. Both expose
   query(sql, params) -> { rows }. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let db;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render's external URLs need TLS; its internal URL works either way
      ssl: /render\.com/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
    db = { query: (sql, params) => pool.query(sql, params), kind: "postgres" };
  } else {
    if (process.env.RENDER) {
      // on Render, never fall back to a throwaway in-memory database
      throw new Error("DATABASE_URL is not set. In Render: campus-vendors-api → Environment → add DATABASE_URL = the Postgres 'Internal Database URL'.");
    }
    const { PGlite } = require("@electric-sql/pglite");
    const lite = new PGlite(); // in memory: wiped when the server stops
    db = { query: (sql, params) => lite.query(sql, params), exec: (sql) => lite.exec(sql), kind: "pglite (in-memory)" };
  }
  await migrate();
  await seed();
  return db;
}

const query = (sql, params) => db.query(sql, params || []);

async function migrate() {
  const statements = [
    `create table if not exists students (
      id bigserial primary key,
      email text not null unique,              -- canonical Gmail (lowercase, no dots / +tags)
      name text not null,
      cls text not null,
      phone text not null,                     -- shown to shops, and used to sign in with the Gmail
      strikes int not null default 0,          -- uncollected orders
      blocked boolean not null default false,
      created_at timestamptz not null default now()
    )`,
    `create table if not exists blocked_emails (
      email text primary key, reason text, blocked_at timestamptz not null default now()
    )`,
    `create table if not exists login_codes (
      email text primary key,                  -- canonical Gmail
      code_hash text not null,
      details jsonb,                           -- name / class / phone typed when creating an account
      attempts int not null default 0,
      sent_at timestamptz not null default now(),
      expires_at timestamptz not null
    )`,
    `create table if not exists sessions (
      token_hash text primary key,
      kind text not null,                      -- 'student' or 'vendor'
      subject text not null,                   -- student id or vendor id
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    )`,
    `create table if not exists vendors (
      id text primary key,
      data jsonb not null,                     -- everything the website shows (menu, hours, status, ...)
      name_key text not null,                  -- name for vendor login matching
      pincode text not null,
      phone text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create sequence if not exists order_token_seq start 101`,
    `create table if not exists orders (
      id text primary key,
      vendor_id text not null references vendors(id) on delete cascade,
      student_id bigint not null references students(id) on delete cascade,
      status text not null,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create index if not exists orders_vendor_idx on orders(vendor_id, created_at desc)`,
    `create index if not exists orders_student_idx on orders(student_id, created_at desc)`,
    `create table if not exists print_files (
      order_id text primary key references orders(id) on delete cascade,
      data_url text not null
    )`,
    `create table if not exists no_shows (
      order_id text primary key,
      student_id bigint not null references students(id) on delete cascade,
      token text, shop text, at timestamptz not null default now()
    )`,
    `create sequence if not exists feedback_ref_seq start 1001`,
    `create table if not exists feedback (
      id text primary key,
      vendor_id text,
      student_id bigint references students(id) on delete set null,
      status text not null default 'open',
      data jsonb not null,
      created_at timestamptz not null default now()
    )`,
  ];
  for (const s of statements) await query(s);
}

/* Load the shop list from the website's own js/data.js (one source of truth),
   and add any shop that isn't in the database yet. */
function seedVendors() {
  const file = path.join(__dirname, "..", "js", "data.js");
  const sandbox = { window: { SEED_VENDORS: [] } };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.window.SEED_VENDORS;
}

const nameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function seed() {
  const shops = seedVendors();
  for (const v of shops) {
    const data = { ...v, ratings: [], updatedAt: Date.now() };
    await query(
      `insert into vendors (id, data, name_key, pincode, phone) values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
      [v.id, JSON.stringify(data), nameKey(v.name), String(v.pincode || "560059"), String(v.phone || "")]
    );
  }
}

module.exports = { connect, query, nameKey, get kind() { return db && db.kind; } };
