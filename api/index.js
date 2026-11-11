/* Satu pintu API untuk halaman Smart Exam: POST /api  {name, args} */
'use strict';
const crypto = require('crypto');
const { makeApi } = require('../lib/api.js');
const { makeStore } = require('../lib/supabase.js');
const { ensureSchema } = require('../lib/autosetup.js');

const ALLOWED = ['hasPin', 'setupPin', 'login', 'changePin', 'uploadImage', 'createExam', 'updateExam', 'deleteExam', 'listExams', 'getExamFull',
  'listResults', 'getResultDetail', 'exportData', 'allowRetake', 'gradeManual', 'deleteResult', 'peekExam', 'joinExam', 'saveProgress', 'submitExam'];

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, ok: !!(url && key) };
}

let setupTried = false;
async function setupIfNeeded(force) {
  if (setupTried && !force) return false;
  setupTried = true;
  try { const r = await ensureSchema(); return r.ok; }
  catch (e) { console.error('autosetup', e.message); return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cfg = config();
  if (req.method === 'GET') {
    // cek kesiapan: buka /api di browser
    if (!cfg.ok) return res.status(200).json({ ok: false, error: 'Supabase belum terhubung. Di Vercel buka proyek ini → Storage → Create Database → Supabase → Connect, lalu Redeploy. (Atau isi SUPABASE_URL dan SUPABASE_SECRET_KEY di Settings → Environment Variables.)' });
    try { await setupIfNeeded(); await makeStore(cfg.url, cfg.key).ping(); return res.status(200).json({ ok: true, data: 'Terhubung ke Supabase. Aplikasi siap dipakai.' }); }
    catch (e) { return res.status(200).json({ ok: false, error: e.userMessage || e.message }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Metode tidak didukung' });
  if (!cfg.ok) return res.status(200).json({ ok: false, error: 'Server belum terhubung ke Supabase. Guru perlu mengisi SUPABASE_URL dan SUPABASE_SECRET_KEY di Vercel lalu Redeploy.' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const name = body && body.name, args = (body && Array.isArray(body.args)) ? body.args : [];
  if (ALLOWED.indexOf(name) < 0) return res.status(400).json({ ok: false, error: 'Fungsi tidak dikenal' });
  try {
    const secret = crypto.createHash('sha256').update('smart-exam|' + cfg.key).digest('hex');
    const api = makeApi(makeStore(cfg.url, cfg.key), secret);
    let data;
    try { data = await api[name].apply(null, args); }
    catch (e) {
      // tabel belum ada → buat otomatis lalu ulangi sekali
      if (/Tabel database belum dibuat|bucket/.test(e.message) && (await setupIfNeeded(true))) data = await api[name].apply(null, args);
      else throw e;
    }
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    if (!e.userMessage) console.error(name, e);
    return res.status(200).json({ ok: false, error: e.userMessage || ('Terjadi kesalahan server: ' + e.message) });
  }
};
