/* Penyimpanan di Supabase lewat REST API (tanpa library tambahan). */
'use strict';
const BUCKET = 'soal-gambar';

function makeStore(url, key) {
  url = String(url || '').replace(/\/+$/, '');
  const base = {
    apikey: key,
    // kunci lama (service_role) berupa JWT; kunci baru (sb_secret_...) cukup lewat header apikey
    ...(/^eyJ/.test(key) ? { Authorization: 'Bearer ' + key } : {})
  };
  async function rest(method, path, body, prefer) {
    const res = await fetch(url + '/rest/v1/' + path, {
      method,
      headers: Object.assign({}, base, { 'Content-Type': 'application/json', Accept: 'application/json' }, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 409) return { conflict: true };
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.message || j.error || text; } catch (e) { }
      if (/relation .* does not exist|Could not find the table/i.test(msg)) msg = 'Tabel database belum dibuat. Jalankan script SQL di Supabase (lihat panduan langkah 3).';
      if (res.status === 401 || /Invalid API key|JWT/i.test(msg)) msg = 'Kunci Supabase salah. Periksa SUPABASE_SECRET_KEY di Vercel.';
      const e = new Error('Database: ' + msg); e.userMessage = e.message; throw e;
    }
    return text ? JSON.parse(text) : null;
  }
  const enc = encodeURIComponent;
  function resultRow(r) {
    return { id: r.id, kode: r.kode, nama_key: r.namaKey, percobaan_ke: r.percobaanKe, nama: r.nama, kelas: r.kelas, status: r.status, nilai: r.nilai, data: r, updated_at: new Date().toISOString() };
  }
  return {
    async getSetting(k) { const r = await rest('GET', 'settings?select=value&key=eq.' + enc(k)); return r && r[0] ? r[0].value : null; },
    async setSetting(k, v) { await rest('POST', 'settings', { key: k, value: v }, 'resolution=merge-duplicates,return=minimal'); },
    async getMeta(kode) { const r = await rest('GET', 'exams?select=meta&kode=eq.' + enc(kode)); return r && r[0] ? r[0].meta : null; },
    async listMetas() { return ((await rest('GET', 'exams?select=meta')) || []).map(x => x.meta); },
    async insertExam(m, content) {
      const r = await rest('POST', 'exams', { kode: m.kode, nama: m.nama, mapel: m.mapel, meta: m, content }, 'return=minimal');
      return !(r && r.conflict);
    },
    async updateExam(m, content) {
      const body = { meta: m, nama: m.nama, mapel: m.mapel };
      if (content) body.content = content;
      await rest('PATCH', 'exams?kode=eq.' + enc(m.kode), body, 'return=minimal');
    },
    async getContent(kode) { const r = await rest('GET', 'exams?select=content&kode=eq.' + enc(kode)); return r && r[0] ? r[0].content : { questions: [], stimuli: [] }; },
    async listResults(kode) { return ((await rest('GET', 'results?select=data&kode=eq.' + enc(kode))) || []).map(x => x.data); },
    async listResultsByKey(kode, key) { return ((await rest('GET', 'results?select=data&kode=eq.' + enc(kode) + '&nama_key=eq.' + enc(key))) || []).map(x => x.data); },
    async listResultCounts() { return (await rest('GET', 'results?select=kode,status')) || []; },
    async getResult(id) { const r = await rest('GET', 'results?select=data&id=eq.' + enc(id)); return r && r[0] ? r[0].data : null; },
    async insertResult(r) { const x = await rest('POST', 'results', resultRow(r), 'return=minimal'); return !(x && x.conflict); },
    async putResult(r) { await rest('POST', 'results', resultRow(r), 'resolution=merge-duplicates,return=minimal'); },
    async deleteResult(id) { await rest('DELETE', 'results?id=eq.' + enc(id), undefined, 'return=minimal'); },
    async uploadImage(name, buf, contentType) {
      const res = await fetch(url + '/storage/v1/object/' + BUCKET + '/' + name, {
        method: 'POST', headers: Object.assign({}, base, { 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }), body: buf
      });
      if (!res.ok) {
        const t = await res.text();
        const e = new Error('Gagal mengunggah gambar ke Supabase Storage' + (/not found/i.test(t) ? ' (bucket "' + BUCKET + '" belum dibuat — jalankan script SQL)' : ': ' + t.slice(0, 150)));
        e.userMessage = e.message; throw e;
      }
      return url + '/storage/v1/object/public/' + BUCKET + '/' + name;
    },
    async ping() { await rest('GET', 'settings?select=key&limit=1'); return true; }
  };
}
module.exports = { makeStore, BUCKET };
