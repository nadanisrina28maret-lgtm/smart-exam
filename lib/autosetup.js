/* Membuat tabel & bucket gambar otomatis saat pertama dipakai.
 * Aktif jika Supabase dihubungkan lewat Vercel (Storage → Supabase), yang mengisi POSTGRES_URL. */
'use strict';
const fs = require('fs');
const path = require('path');

let done = false;
function dbUrl() { return require('./env.js').postgresUrl(); }
async function ensureSchema() {
  if (done) return { ok: true, skipped: false };
  const raw = dbUrl();
  if (!raw) return { ok: false, reason: 'no-db-url' };
  let pg;
  try { pg = require('pg'); } catch (e) { return { ok: false, reason: 'no-pg' }; }
  // sertifikat Supabase tidak lolos verifikasi ketat node-postgres; enkripsi tetap aktif
  const u = new URL(raw);
  const noSsl = u.searchParams.get('sslmode') === 'disable';
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'supa', 'pgbouncer'].forEach(k => u.searchParams.delete(k));
  const client = new pg.Client({ connectionString: u.toString(), ssl: noSsl ? false : { rejectUnauthorized: false } });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-setup.sql'), 'utf8');
  await client.connect();
  try { await client.query(sql); done = true; return { ok: true }; }
  finally { await client.end().catch(() => { }); }
}
module.exports = { ensureSchema, dbUrl };
