/* ============================================================
 * SMART EXAM — LOGIKA SERVER (versi Vercel + Supabase)
 * Penilaian memakai fungsi yang sama dengan versi Apps Script (core.js).
 * ============================================================ */
'use strict';
const crypto = require('crypto');
const SECore = require('./core.js');

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GRACE_MS = 2 * 60 * 1000;
const TOKEN_HOURS = 12;

function err(msg) { const e = new Error(msg); e.userMessage = msg; return e; }
function normKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function normKelas(s) { return String(s || '').toUpperCase().replace(/[\s\-_.]+/g, ''); }
function randStr(n, chars) {
  chars = chars || 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.randomBytes(n); let s = '';
  for (let i = 0; i < n; i++) s += chars[b[i] % chars.length];
  return s;
}
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function fmtDate(ms) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)) + ' WIB';
}
function examWindow(meta, now) {
  if (meta.status === 'nonaktif') return { ok: false, state: 'nonaktif', msg: 'Ujian ini sedang dinonaktifkan oleh guru.' };
  if (meta.mulai && now < meta.mulai) return { ok: false, state: 'belum', msg: 'Ujian belum dimulai.', mulai: meta.mulai };
  if (meta.selesai && now > meta.selesai) return { ok: false, state: 'tutup', msg: 'Waktu ujian sudah ditutup.' };
  return { ok: true, state: 'buka' };
}
function stripSecret(r) { const o = Object.assign({}, r); delete o.secret; return o; }

function makeApi(S, secret) {
  /* ---- token guru: ditandatangani, berlaku 12 jam, batal otomatis jika PIN diganti ---- */
  async function newToken() {
    const exp = Date.now() + TOKEN_HOURS * 3600e3;
    const ph = (await S.getSetting('pinHash')) || '';
    return exp + '.' + sha256(secret + '|' + exp + '|' + ph).slice(0, 40);
  }
  async function requireTeacher(token) {
    const p = String(token || '').split('.');
    const ok = p.length === 2 && Number(p[0]) > Date.now() &&
      sha256(secret + '|' + p[0] + '|' + ((await S.getSetting('pinHash')) || '')).slice(0, 40) === p[1];
    if (!ok) throw err('Sesi guru berakhir. Silakan masuk lagi.');
  }
  async function getMetaOrFail(kode) {
    const m = await S.getMeta(String(kode || '').toUpperCase().trim());
    if (!m || m.status === 'dihapus') throw err('Kode ujian tidak ditemukan. Periksa kembali kode dari guru.');
    return m;
  }
  function deadlineOf(meta, r) {
    let d = r.mulai + meta.durasi * 60000;
    if (meta.selesai) d = Math.min(d, meta.selesai);
    return d;
  }
  async function finalize(meta, r, answers, violations, reason, content) {
    content = content || await S.getContent(meta.kode);
    const now = Date.now();
    if (answers) r.jawaban = answers;
    if (typeof violations === 'number') r.pelanggaran = Math.max(r.pelanggaran || 0, violations);
    const g = SECore.grade(content, r.jawaban, r.skorManual, meta.aturan);
    r.status = 'selesai';
    r.selesai = Math.min(now, deadlineOf(meta, r) + GRACE_MS);
    r.durasiDetik = Math.max(0, Math.round((r.selesai - r.mulai) / 1000));
    r.nilai = g.nilai; r.benar = g.benar; r.salah = g.salah; r.kosong = g.kosong; r.menunggu = g.menunggu;
    r.detailSkor = g.perSoal;
    if (reason) r.catatan = reason;
    await S.putResult(r);
    return g;
  }
  async function closeStale(meta, results) {
    const now = Date.now();
    let content = null;
    for (const r of results) {
      if (r.status === 'berlangsung' && now > deadlineOf(meta, r) + GRACE_MS) {
        content = content || await S.getContent(meta.kode);
        await finalize(meta, r, null, null, 'Dikumpulkan otomatis (waktu habis) dari jawaban tersimpan terakhir', content);
      }
    }
    return results;
  }
  function summaryFor(m, r) {
    const show = (m.aturan || {}).tampilkanNilai !== false;
    return { status: 'selesai', tampilkanNilai: show, nilai: show ? r.nilai : null, benar: show ? r.benar : null, salah: show ? r.salah : null, kosong: show ? r.kosong : null, menunggu: show ? r.menunggu : null, durasiDetik: r.durasiDetik };
  }
  function regrade(content, m, r) {
    const g = SECore.grade(content, r.jawaban, r.skorManual, m.aturan);
    r.nilai = g.nilai; r.benar = g.benar; r.salah = g.salah; r.kosong = g.kosong; r.menunggu = g.menunggu; r.detailSkor = g.perSoal;
  }

  const api = {
    /* ===== GURU ===== */
    async hasPin() { return !!(await S.getSetting('pinHash')); },
    async setupPin(pin) {
      if (await S.getSetting('pinHash')) throw err('PIN guru sudah dibuat sebelumnya.');
      if (!pin || String(pin).length < 4) throw err('PIN minimal 4 karakter.');
      const salt = randStr(12);
      await S.setSetting('pinSalt', salt);
      await S.setSetting('pinHash', sha256(salt + String(pin)));
      return newToken();
    },
    async login(pin) {
      const h = await S.getSetting('pinHash');
      if (!h) throw err('PIN guru belum dibuat.');
      if (sha256((await S.getSetting('pinSalt')) + String(pin)) !== h) throw err('PIN salah.');
      return newToken();
    },
    async changePin(token, oldPin, newPin) {
      await requireTeacher(token);
      if (sha256((await S.getSetting('pinSalt')) + String(oldPin)) !== (await S.getSetting('pinHash'))) throw err('PIN lama salah.');
      if (!newPin || String(newPin).length < 4) throw err('PIN baru minimal 4 karakter.');
      const salt = randStr(12);
      await S.setSetting('pinSalt', salt);
      await S.setSetting('pinHash', sha256(salt + String(newPin)));
      return newToken(); // token lama otomatis tidak berlaku
    },
    async uploadImage(token, dataUrl) {
      await requireTeacher(token);
      const m = /^data:(image\/(png|jpe?g|gif|webp|bmp|svg\+xml));base64,(.+)$/i.exec(String(dataUrl || ''));
      if (!m) throw err('Format gambar tidak didukung.');
      const buf = Buffer.from(m[3], 'base64');
      if (buf.length > 4 * 1024 * 1024) throw err('Gambar terlalu besar (maks 4 MB).');
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }[m[1].toLowerCase()];
      const name = crypto.createHash('sha1').update(buf).digest('hex') + '.' + ext;
      return S.uploadImage(name, buf, m[1].toLowerCase());
    },
    async createExam(token, meta, content) {
      await requireTeacher(token);
      const probs = SECore.validateContent(content);
      if (probs.length) throw err('Ujian belum bisa dibuat:\n• ' + probs.slice(0, 8).join('\n• ') + (probs.length > 8 ? '\n• …dan ' + (probs.length - 8) + ' lainnya' : ''));
      if (!meta.nama) throw err('Nama ujian wajib diisi.');
      if (!(meta.durasi > 0)) throw err('Durasi wajib diisi (menit).');
      const now = Date.now();
      for (let i = 0; i < 20; i++) {
        const m = {
          kode: randStr(6, CODE_CHARS), nama: String(meta.nama).trim(), jenjang: meta.jenjang || '', mapel: meta.mapel || '',
          kelasList: (meta.kelasList || []).map(k => String(k).trim()).filter(Boolean),
          durasi: Number(meta.durasi), mulai: meta.mulai || null, selesai: meta.selesai || null,
          aturan: meta.aturan || {}, jumlahSoal: content.questions.length, dibuat: now, status: 'aktif'
        };
        if (await S.insertExam(m, content)) return m; // false = kode sudah dipakai, coba kode lain
      }
      throw err('Gagal membuat kode unik, coba lagi.');
    },
    async updateExam(token, kode, meta, content) {
      await requireTeacher(token);
      const m = await getMetaOrFail(kode);
      if (content) {
        const probs = SECore.validateContent(content);
        if (probs.length) throw err('Perubahan belum bisa disimpan:\n• ' + probs.slice(0, 8).join('\n• '));
      }
      ['nama', 'jenjang', 'mapel', 'kelasList', 'durasi', 'mulai', 'selesai', 'aturan', 'status'].forEach(k => {
        if (meta && meta[k] !== undefined) m[k] = meta[k];
      });
      if (content) m.jumlahSoal = content.questions.length;
      await S.updateExam(m, content || null);
      return m;
    },
    async deleteExam(token, kode) {
      await requireTeacher(token);
      const m = await getMetaOrFail(kode);
      m.status = 'dihapus'; await S.updateExam(m, null); return true;
    },
    async listExams(token) {
      await requireTeacher(token);
      const now = Date.now();
      const [metas, lite] = await Promise.all([S.listMetas(), S.listResultCounts()]);
      return metas.filter(m => m.status !== 'dihapus').map(m => {
        const rs = lite.filter(r => r.kode === m.kode);
        m.peserta = rs.length;
        m.selesaiCount = rs.filter(r => r.status === 'selesai').length;
        m.window = examWindow(m, now).state;
        return m;
      }).sort((a, b) => b.dibuat - a.dibuat);
    },
    async getExamFull(token, kode) {
      await requireTeacher(token);
      const m = await getMetaOrFail(kode);
      return { meta: m, content: await S.getContent(m.kode) };
    },
    async listResults(token, kode) {
      await requireTeacher(token);
      const m = await getMetaOrFail(kode);
      const rs = await closeStale(m, await S.listResults(m.kode));
      return { meta: m, results: rs.map(stripSecret) };
    },
    async getResultDetail(token, id) {
      await requireTeacher(token);
      const r = await S.getResult(id); if (!r) throw err('Data peserta tidak ditemukan.');
      const m = await getMetaOrFail(r.kode);
      return { meta: m, content: await S.getContent(m.kode), result: stripSecret(r) };
    },
    async exportData(token, kode) {
      await requireTeacher(token);
      const m = await getMetaOrFail(kode);
      const rs = await closeStale(m, await S.listResults(m.kode));
      return { meta: m, content: await S.getContent(m.kode), results: rs.map(stripSecret) };
    },
    async allowRetake(token, id, allow) {
      await requireTeacher(token);
      const r = await S.getResult(id); if (!r) throw err('Data peserta tidak ditemukan.');
      r.izinUlang = allow !== false; await S.putResult(r); return stripSecret(r);
    },
    async gradeManual(token, id, scores) {
      await requireTeacher(token);
      const r = await S.getResult(id); if (!r) throw err('Data peserta tidak ditemukan.');
      const m = await getMetaOrFail(r.kode);
      r.skorManual = Object.assign({}, r.skorManual || {}, scores || {});
      regrade(await S.getContent(m.kode), m, r);
      await S.putResult(r);
      return stripSecret(r);
    },
    async deleteResult(token, id) {
      await requireTeacher(token);
      await S.deleteResult(id); return true;
    },

    /* ===== SISWA ===== */
    async peekExam(kode) {
      const m = await getMetaOrFail(kode);
      return { kode: m.kode, nama: m.nama, mapel: m.mapel, jenjang: m.jenjang, kelasList: m.kelasList || [], durasi: m.durasi, jumlahSoal: m.jumlahSoal, mulai: m.mulai, selesai: m.selesai, window: examWindow(m, Date.now()) };
    },
    async joinExam(kode, nama, kelas, deviceId, _retry) {
      nama = String(nama || '').replace(/\s+/g, ' ').trim();
      kelas = String(kelas || '').replace(/\s+/g, ' ').trim();
      if (!String(kode || '').trim()) throw err('Kode ujian wajib diisi.');
      if (!nama) throw err('Nama lengkap wajib diisi.');
      if (!kelas) throw err('Kelas wajib diisi.');
      if (nama.length < 3) throw err('Tulis nama lengkap (minimal 3 huruf).');
      const m = await getMetaOrFail(kode);
      const now = Date.now();
      const w = examWindow(m, now);
      if (!w.ok) throw err(w.msg + (w.mulai ? ' Ujian dibuka pada ' + fmtDate(w.mulai) + '.' : ''));
      if (m.kelasList && m.kelasList.length && m.kelasList.map(normKelas).indexOf(normKelas(kelas)) < 0) {
        throw err('Kelas "' + kelas + '" tidak terdaftar untuk ujian ini. Pilih kelas dari daftar.');
      }
      const key = normKey(nama) + '|' + normKelas(kelas);
      const mine = (await S.listResultsByKey(m.kode, key)).sort((a, b) => a.percobaanKe - b.percobaanKe);
      const last = mine[mine.length - 1];
      let resume = false, r;
      if (last && last.status === 'berlangsung' && now <= deadlineOf(m, last)) {
        r = last; resume = true;
        if (deviceId && last.deviceId && deviceId !== last.deviceId) {
          r.pelanggaran = (r.pelanggaran || 0) + 1;
          r.catatan = ((r.catatan || '') + ' Melanjutkan dari perangkat lain.').trim();
          r.deviceId = deviceId;
          await S.putResult(r);
        }
      } else {
        if (last && last.status === 'berlangsung') {
          await finalize(m, last, null, null, 'Dikumpulkan otomatis (waktu habis) dari jawaban tersimpan terakhir');
        }
        const maxTry = Math.max(1, Number((m.aturan || {}).maksPercobaan) || 1);
        if (mine.length >= maxTry && !(last && last.izinUlang)) {
          throw err('Nama "' + nama + '" di kelas ' + kelas + ' sudah mengikuti ujian ini. Hubungi guru jika perlu mengulang.');
        }
        r = {
          id: 'R' + now.toString(36) + randStr(5), kode: m.kode, nama, kelas, namaKey: key,
          mapel: m.mapel, status: 'berlangsung', mulai: now, selesai: null, durasiDetik: 0,
          nilai: null, benar: 0, salah: 0, kosong: 0, menunggu: 0, pelanggaran: 0,
          percobaanKe: mine.length + 1, izinUlang: false, secret: randStr(24), deviceId: deviceId || '',
          jawaban: {}, skorManual: {}, detailSkor: {}, catatan: ''
        };
        // unik per (kode, nama+kelas, percobaan): klik ganda tidak membuat dua percobaan
        if (!(await S.insertResult(r))) {
          if (_retry) throw err('Sedang memproses, coba tekan masuk sekali lagi.');
          return api.joinExam(kode, nama, kelas, deviceId, true);
        }
        if (last && last.izinUlang) { last.izinUlang = false; last.catatan = ((last.catatan || '') + ' Ulang diizinkan guru.').trim(); await S.putResult(last); }
      }
      const content = SECore.studentContent(await S.getContent(m.kode));
      return {
        attemptId: r.id, secret: r.secret, resume, serverNow: now, mulai: r.mulai,
        deadline: deadlineOf(m, r), jawaban: r.jawaban || {}, pelanggaran: r.pelanggaran || 0,
        exam: { kode: m.kode, nama: m.nama, mapel: m.mapel, jenjang: m.jenjang, durasi: m.durasi, aturan: m.aturan || {} },
        peserta: { nama: r.nama, kelas: r.kelas }, content
      };
    },
    async saveProgress(id, secret, answers, violations) {
      const r = await S.getResult(id);
      if (!r || r.secret !== secret) throw err('Sesi ujian tidak valid.');
      if (r.status !== 'berlangsung') return { status: r.status };
      const m = await getMetaOrFail(r.kode);
      if (Date.now() <= deadlineOf(m, r) + GRACE_MS) r.jawaban = answers || r.jawaban;
      r.pelanggaran = Math.max(r.pelanggaran || 0, Number(violations) || 0);
      await S.putResult(r);
      return { status: r.status, serverNow: Date.now(), deadline: deadlineOf(m, r) };
    },
    async submitExam(id, secret, answers, violations, reason) {
      const r = await S.getResult(id);
      if (!r || r.secret !== secret) throw err('Sesi ujian tidak valid.');
      const m = await getMetaOrFail(r.kode);
      if (r.status !== 'berlangsung') return summaryFor(m, r);
      const late = Date.now() > deadlineOf(m, r) + GRACE_MS;
      await finalize(m, r, late ? null : answers, Number(violations) || 0, late ? 'Terlambat mengirim; dinilai dari jawaban tersimpan terakhir' : (reason || ''));
      return summaryFor(m, r);
    }
  };
  return api;
}

module.exports = { makeApi };
