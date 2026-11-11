/* ============================================================
 * SMART EXAM — CORE (dipakai di server Apps Script & mode demo)
 * Semua logika bisnis: kode ujian, masuk siswa, batas percobaan,
 * penilaian, rekap. Penyimpanan lewat "adapter" (S).
 * ============================================================ */
var SECore = (function () {
  'use strict';

  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // tanpa 0 O 1 I L
  var GRACE_MS = 2 * 60 * 1000; // toleransi kirim setelah waktu habis

  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }
  function normKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function normKelas(s) { return String(s || '').toUpperCase().replace(/[\s\-_.]+/g, ''); }
  function randStr(n, chars) {
    chars = chars || 'abcdefghijklmnopqrstuvwxyz0123456789';
    var s = ''; for (var i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }
  function isEmpty(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }
  function normText(s) {
    return String(s || '').toLowerCase()
      .replace(/<[^>]*>/g, ' ')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/[.,;:!?"'()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function asNumber(s) {
    var t = String(s || '').trim().replace(/\s/g, '');
    if (!/^[-+]?\d+([.,]\d+)?$/.test(t)) return null;
    return parseFloat(t.replace(',', '.'));
  }

  /* ---------------- PENILAIAN ---------------- */
  // Mengembalikan {nilai, benar, salah, kosong, menunggu, totalBobot, perSoal:{qid:{status,skor,bobot}}}
  function grade(content, answers, manual, rules) {
    answers = answers || {}; manual = manual || {}; rules = rules || {};
    var partial = rules.skorParsial !== false;
    var res = { benar: 0, salah: 0, kosong: 0, menunggu: 0, totalBobot: 0, didapat: 0, perSoal: {} };
    (content.questions || []).forEach(function (q) {
      var w = Number(q.weight) > 0 ? Number(q.weight) : 1;
      res.totalBobot += w;
      var a = answers[q.id];
      var st = 'salah', sk = 0;
      if (q.type === 'URAIAN') {
        if (manual[q.id] !== undefined && manual[q.id] !== null && manual[q.id] !== '') {
          sk = Math.max(0, Math.min(w, Number(manual[q.id]) || 0));
          st = isEmpty(a) ? 'kosong' : (sk >= w ? 'benar' : 'dinilai');
        } else {
          st = isEmpty(a) ? 'kosong' : 'menunggu';
        }
      } else if (isEmpty(a)) {
        st = 'kosong';
      } else if (q.type === 'PG') {
        if (String(a) === String(q.key)) { st = 'benar'; sk = w; }
      } else if (q.type === 'PGK') {
        var key = (q.key || []).slice().sort().join(',');
        var got = (Array.isArray(a) ? a : [a]).slice().sort().join(',');
        if (key && key === got) { st = 'benar'; sk = w; }
      } else if (q.type === 'BS') {
        var sts = q.statements || [], ok = 0, answered = 0;
        sts.forEach(function (s) {
          if (a[s.id] !== undefined && a[s.id] !== null) answered++;
          if (a[s.id] === s.key) ok++;
        });
        if (answered === 0) st = 'kosong';
        else if (ok === sts.length) { st = 'benar'; sk = w; }
        else { sk = partial && sts.length ? w * ok / sts.length : 0; }
      } else if (q.type === 'JODOH') {
        var left = (q.pairs && q.pairs.left) || [], k2 = (q.pairs && q.pairs.key) || {}, ok2 = 0, ans2 = 0;
        left.forEach(function (l) {
          if (a[l.id]) ans2++;
          if (a[l.id] && a[l.id] === k2[l.id]) ok2++;
        });
        if (ans2 === 0) st = 'kosong';
        else if (ok2 === left.length) { st = 'benar'; sk = w; }
        else { sk = partial && left.length ? w * ok2 / left.length : 0; }
      } else if (q.type === 'ISIAN') {
        var ta = normText(a), na = asNumber(a);
        var hit = (q.answers || []).some(function (k) {
          var nk = asNumber(k);
          if (na !== null && nk !== null) return Math.abs(na - nk) < 1e-9;
          return normText(k) === ta && ta !== '';
        });
        if (hit) { st = 'benar'; sk = w; }
      }
      if (st === 'benar') res.benar++;
      else if (st === 'kosong') res.kosong++;
      else if (st === 'menunggu') res.menunggu++;
      else res.salah++;
      res.didapat += sk;
      res.perSoal[q.id] = { status: st, skor: Math.round(sk * 100) / 100, bobot: w };
    });
    res.nilai = res.totalBobot ? Math.round(res.didapat / res.totalBobot * 10000) / 100 : 0;
    return res;
  }

  /* ---------------- KONTEN UNTUK SISWA (tanpa kunci) ---------------- */
  function studentContent(content) {
    var qs = (content.questions || []).map(function (q) {
      var o = { id: q.id, type: q.type, html: q.html, stimulusId: q.stimulusId || null, weight: q.weight || 1 };
      if (q.type === 'PG' || q.type === 'PGK') o.options = q.options;
      if (q.type === 'BS') {
        o.statements = (q.statements || []).map(function (s) { return { id: s.id, html: s.html }; });
        o.labels = q.labels || ['Benar', 'Salah'];
      }
      if (q.type === 'JODOH') {
        o.pairs = { left: q.pairs.left, right: q.pairs.right };
      }
      return o;
    });
    return { questions: qs, stimuli: content.stimuli || [] };
  }

  function validateContent(content) {
    var problems = [];
    var qs = content.questions || [];
    if (!qs.length) problems.push('Belum ada soal.');
    qs.forEach(function (q, i) {
      var n = 'Soal ' + (i + 1);
      if (!q.type) problems.push(n + ': jenis soal belum ditentukan.');
      else if (q.type === 'PG' && !q.key) problems.push(n + ': kunci jawaban belum diatur.');
      else if (q.type === 'PGK' && !(q.key && q.key.length)) problems.push(n + ': kunci jawaban belum diatur.');
      else if (q.type === 'BS' && (!(q.statements && q.statements.length) || q.statements.some(function (s) { return s.key !== true && s.key !== false; }))) problems.push(n + ': kunci Benar/Salah belum lengkap.');
      else if (q.type === 'JODOH' && (!(q.pairs && q.pairs.left && q.pairs.left.length) || q.pairs.left.some(function (l) { return !q.pairs.key || !q.pairs.key[l.id]; }))) problems.push(n + ': pasangan jawaban belum lengkap.');
      else if (q.type === 'ISIAN' && !(q.answers && q.answers.filter(function (x) { return String(x).trim(); }).length)) problems.push(n + ': jawaban isian belum diisi.');
      if ((q.type === 'PG' || q.type === 'PGK') && (!q.options || q.options.length < 2)) problems.push(n + ': pilihan jawaban kurang dari 2.');
    });
    return problems;
  }

  /* ---------------- STATUS WAKTU ---------------- */
  function examWindow(meta, now) {
    if (meta.status === 'nonaktif') return { ok: false, state: 'nonaktif', msg: 'Ujian ini sedang dinonaktifkan oleh guru.' };
    if (meta.mulai && now < meta.mulai) return { ok: false, state: 'belum', msg: 'Ujian belum dimulai.', mulai: meta.mulai };
    if (meta.selesai && now > meta.selesai) return { ok: false, state: 'tutup', msg: 'Waktu ujian sudah ditutup.' };
    return { ok: true, state: 'buka' };
  }

  function makeApi(S) {
    function requireTeacher(token) {
      if (!token || !S.checkToken(token)) throw err('Sesi guru berakhir. Silakan masuk lagi.');
    }
    function getMetaOrFail(kode) {
      var m = S.getMeta(String(kode || '').toUpperCase().trim());
      if (!m || m.status === 'dihapus') throw err('Kode ujian tidak ditemukan. Periksa kembali kode dari guru.');
      return m;
    }
    function deadlineOf(meta, r) {
      var d = r.mulai + meta.durasi * 60000;
      if (meta.selesai) d = Math.min(d, meta.selesai);
      return d;
    }
    function finalize(meta, r, answers, violations, reason) {
      var content = S.getContent(meta.kode);
      var now = S.now();
      if (answers) r.jawaban = answers;
      if (typeof violations === 'number') r.pelanggaran = Math.max(r.pelanggaran || 0, violations);
      var g = grade(content, r.jawaban, r.skorManual, meta.aturan);
      r.status = 'selesai';
      r.selesai = Math.min(now, deadlineOf(meta, r) + GRACE_MS);
      r.durasiDetik = Math.max(0, Math.round((r.selesai - r.mulai) / 1000));
      r.nilai = g.nilai; r.benar = g.benar; r.salah = g.salah; r.kosong = g.kosong; r.menunggu = g.menunggu;
      r.detailSkor = g.perSoal;
      if (reason) r.catatan = reason;
      S.putResult(r);
      return g;
    }
    function closeStale(meta) {
      var now = S.now();
      S.listResults(meta.kode).forEach(function (r) {
        if (r.status === 'berlangsung' && now > deadlineOf(meta, r) + GRACE_MS) {
          S.lock(function () { finalize(meta, r, null, null, 'Dikumpulkan otomatis (waktu habis) dari jawaban tersimpan terakhir'); });
        }
      });
    }

    var api = {
      /* ===== GURU ===== */
      hasPin: function () { return !!S.getSetting('pinHash'); },
      setupPin: function (pin) {
        if (S.getSetting('pinHash')) throw err('PIN guru sudah dibuat sebelumnya.');
        if (!pin || String(pin).length < 4) throw err('PIN minimal 4 karakter.');
        var salt = randStr(12);
        S.setSetting('pinSalt', salt);
        S.setSetting('pinHash', S.hash(salt + String(pin)));
        return S.newToken();
      },
      login: function (pin) {
        var h = S.getSetting('pinHash');
        if (!h) throw err('PIN guru belum dibuat.');
        if (S.hash(S.getSetting('pinSalt') + String(pin)) !== h) throw err('PIN salah.');
        return S.newToken();
      },
      changePin: function (token, oldPin, newPin) {
        requireTeacher(token);
        if (S.hash(S.getSetting('pinSalt') + String(oldPin)) !== S.getSetting('pinHash')) throw err('PIN lama salah.');
        if (!newPin || String(newPin).length < 4) throw err('PIN baru minimal 4 karakter.');
        var salt = randStr(12);
        S.setSetting('pinSalt', salt);
        S.setSetting('pinHash', S.hash(salt + String(newPin)));
        return true;
      },
      createExam: function (token, meta, content) {
        requireTeacher(token);
        var probs = validateContent(content);
        if (probs.length) throw err('Ujian belum bisa dibuat:\n• ' + probs.slice(0, 8).join('\n• ') + (probs.length > 8 ? '\n• …dan ' + (probs.length - 8) + ' lainnya' : ''));
        if (!meta.nama) throw err('Nama ujian wajib diisi.');
        if (!(meta.durasi > 0)) throw err('Durasi wajib diisi (menit).');
        return S.lock(function () {
          var kode;
          for (var i = 0; i < 50; i++) { kode = randStr(6, CODE_CHARS); if (!S.getMeta(kode)) break; }
          var m = {
            kode: kode, nama: String(meta.nama).trim(), jenjang: meta.jenjang || '', mapel: meta.mapel || '',
            kelasList: (meta.kelasList || []).map(function (k) { return String(k).trim(); }).filter(String),
            durasi: Number(meta.durasi), mulai: meta.mulai || null, selesai: meta.selesai || null,
            aturan: meta.aturan || {}, jumlahSoal: content.questions.length, dibuat: S.now(), status: 'aktif'
          };
          S.putContent(kode, content);
          S.putMeta(m);
          return m;
        });
      },
      updateExam: function (token, kode, meta, content) {
        requireTeacher(token);
        var m = getMetaOrFail(kode);
        if (content) {
          var probs = validateContent(content);
          if (probs.length) throw err('Perubahan belum bisa disimpan:\n• ' + probs.slice(0, 8).join('\n• '));
        }
        return S.lock(function () {
          ['nama', 'jenjang', 'mapel', 'kelasList', 'durasi', 'mulai', 'selesai', 'aturan', 'status'].forEach(function (k) {
            if (meta && meta[k] !== undefined) m[k] = meta[k];
          });
          if (content) { S.putContent(m.kode, content); m.jumlahSoal = content.questions.length; }
          S.putMeta(m);
          return m;
        });
      },
      deleteExam: function (token, kode) {
        requireTeacher(token);
        var m = getMetaOrFail(kode);
        m.status = 'dihapus'; S.putMeta(m); return true;
      },
      listExams: function (token) {
        requireTeacher(token);
        var now = S.now();
        return S.listMetas().filter(function (m) { return m.status !== 'dihapus'; }).map(function (m) {
          var rs = S.listResults(m.kode);
          m.peserta = rs.length;
          m.selesaiCount = rs.filter(function (r) { return r.status === 'selesai'; }).length;
          m.window = examWindow(m, now).state;
          return m;
        }).sort(function (a, b) { return b.dibuat - a.dibuat; });
      },
      getExamFull: function (token, kode) {
        requireTeacher(token);
        var m = getMetaOrFail(kode);
        return { meta: m, content: S.getContent(m.kode) };
      },
      listResults: function (token, kode) {
        requireTeacher(token);
        var m = getMetaOrFail(kode);
        closeStale(m);
        return { meta: m, results: S.listResults(m.kode).map(stripSecret) };
      },
      getResultDetail: function (token, id) {
        requireTeacher(token);
        var r = S.getResult(id); if (!r) throw err('Data peserta tidak ditemukan.');
        var m = getMetaOrFail(r.kode);
        return { meta: m, content: S.getContent(m.kode), result: stripSecret(r) };
      },
      exportData: function (token, kode) {
        requireTeacher(token);
        var m = getMetaOrFail(kode);
        closeStale(m);
        return { meta: m, content: S.getContent(m.kode), results: S.listResults(m.kode).map(stripSecret) };
      },
      allowRetake: function (token, id, allow) {
        requireTeacher(token);
        return S.lock(function () {
          var r = S.getResult(id); if (!r) throw err('Data peserta tidak ditemukan.');
          r.izinUlang = allow !== false; S.putResult(r); return stripSecret(r);
        });
      },
      gradeManual: function (token, id, scores) {
        requireTeacher(token);
        return S.lock(function () {
          var r = S.getResult(id); if (!r) throw err('Data peserta tidak ditemukan.');
          var m = getMetaOrFail(r.kode);
          r.skorManual = Object.assign({}, r.skorManual || {}, scores || {});
          var g = grade(S.getContent(m.kode), r.jawaban, r.skorManual, m.aturan);
          r.nilai = g.nilai; r.benar = g.benar; r.salah = g.salah; r.kosong = g.kosong; r.menunggu = g.menunggu;
          r.detailSkor = g.perSoal;
          S.putResult(r);
          return stripSecret(r);
        });
      },
      deleteResult: function (token, id) {
        requireTeacher(token);
        return S.lock(function () { S.deleteResult(id); return true; });
      },

      /* ===== SISWA ===== */
      peekExam: function (kode) {
        var m = getMetaOrFail(kode);
        var w = examWindow(m, S.now());
        return { kode: m.kode, nama: m.nama, mapel: m.mapel, jenjang: m.jenjang, kelasList: m.kelasList || [], durasi: m.durasi, jumlahSoal: m.jumlahSoal, mulai: m.mulai, selesai: m.selesai, window: w };
      },
      joinExam: function (kode, nama, kelas, deviceId) {
        nama = String(nama || '').replace(/\s+/g, ' ').trim();
        kelas = String(kelas || '').replace(/\s+/g, ' ').trim();
        if (!String(kode || '').trim()) throw err('Kode ujian wajib diisi.');
        if (!nama) throw err('Nama lengkap wajib diisi.');
        if (!kelas) throw err('Kelas wajib diisi.');
        if (nama.length < 3) throw err('Tulis nama lengkap (minimal 3 huruf).');
        var m = getMetaOrFail(kode);
        var now = S.now();
        var w = examWindow(m, now);
        if (!w.ok) throw err(w.msg + (w.mulai ? ' Ujian dibuka pada ' + S.fmtDate(w.mulai) + '.' : ''));
        if (m.kelasList && m.kelasList.length && m.kelasList.map(normKelas).indexOf(normKelas(kelas)) < 0) {
          throw err('Kelas "' + kelas + '" tidak terdaftar untuk ujian ini. Pilih kelas dari daftar.');
        }
        var key = normKey(nama) + '|' + normKelas(kelas);
        return S.lock(function () {
          var mine = S.listResults(m.kode).filter(function (r) { return r.namaKey === key; })
            .sort(function (a, b) { return a.percobaanKe - b.percobaanKe; });
          var last = mine[mine.length - 1];
          var resume = false, r;
          if (last && last.status === 'berlangsung' && now <= deadlineOf(m, last)) {
            r = last; resume = true;
            if (deviceId && last.deviceId && deviceId !== last.deviceId) {
              r.pelanggaran = (r.pelanggaran || 0) + 1;
              r.catatan = ((r.catatan || '') + ' Melanjutkan dari perangkat lain.').trim();
              r.deviceId = deviceId;
              S.putResult(r);
            }
          } else {
            if (last && last.status === 'berlangsung') {
              finalize(m, last, null, null, 'Dikumpulkan otomatis (waktu habis) dari jawaban tersimpan terakhir');
            }
            var maxTry = Math.max(1, Number((m.aturan || {}).maksPercobaan) || 1);
            if (mine.length >= maxTry && !(last && last.izinUlang)) {
              throw err('Nama "' + nama + '" di kelas ' + kelas + ' sudah mengikuti ujian ini. Hubungi guru jika perlu mengulang.');
            }
            if (last && last.izinUlang) { last.izinUlang = false; last.catatan = ((last.catatan || '') + ' Ulang diizinkan guru.').trim(); S.putResult(last); }
            r = {
              id: 'R' + now.toString(36) + randStr(5), kode: m.kode, nama: nama, kelas: kelas, namaKey: key,
              mapel: m.mapel, status: 'berlangsung', mulai: now, selesai: null, durasiDetik: 0,
              nilai: null, benar: 0, salah: 0, kosong: 0, menunggu: 0, pelanggaran: 0,
              percobaanKe: mine.length + 1, izinUlang: false, secret: randStr(24), deviceId: deviceId || '',
              jawaban: {}, skorManual: {}, detailSkor: {}, catatan: ''
            };
            S.putResult(r);
          }
          var content = studentContent(S.getContent(m.kode));
          return {
            attemptId: r.id, secret: r.secret, resume: resume, serverNow: now, mulai: r.mulai,
            deadline: deadlineOf(m, r), jawaban: r.jawaban || {}, pelanggaran: r.pelanggaran || 0,
            exam: { kode: m.kode, nama: m.nama, mapel: m.mapel, jenjang: m.jenjang, durasi: m.durasi, aturan: m.aturan || {} },
            peserta: { nama: r.nama, kelas: r.kelas },
            content: content
          };
        });
      },
      saveProgress: function (id, secret, answers, violations) {
        return S.lock(function () {
          var r = S.getResult(id);
          if (!r || r.secret !== secret) throw err('Sesi ujian tidak valid.');
          if (r.status !== 'berlangsung') return { status: r.status };
          var m = getMetaOrFail(r.kode);
          if (S.now() <= deadlineOf(m, r) + GRACE_MS) r.jawaban = answers || r.jawaban;
          r.pelanggaran = Math.max(r.pelanggaran || 0, Number(violations) || 0);
          S.putResult(r);
          return { status: r.status, serverNow: S.now(), deadline: deadlineOf(m, r) };
        });
      },
      submitExam: function (id, secret, answers, violations, reason) {
        return S.lock(function () {
          var r = S.getResult(id);
          if (!r || r.secret !== secret) throw err('Sesi ujian tidak valid.');
          var m = getMetaOrFail(r.kode);
          if (r.status !== 'berlangsung') {
            return summaryFor(m, r);
          }
          var late = S.now() > deadlineOf(m, r) + GRACE_MS;
          finalize(m, r, late ? null : answers, Number(violations) || 0, late ? 'Terlambat mengirim; dinilai dari jawaban tersimpan terakhir' : (reason || ''));
          return summaryFor(m, r);
        });
      }
    };
    function summaryFor(m, r) {
      var show = (m.aturan || {}).tampilkanNilai !== false;
      return {
        status: 'selesai', tampilkanNilai: show,
        nilai: show ? r.nilai : null, benar: show ? r.benar : null, salah: show ? r.salah : null,
        kosong: show ? r.kosong : null, menunggu: show ? r.menunggu : null, durasiDetik: r.durasiDetik
      };
    }
    function stripSecret(r) {
      var o = {}; Object.keys(r).forEach(function (k) { if (k !== 'secret') o[k] = r[k]; }); return o;
    }
    return api;
  }

  return { makeApi: makeApi, grade: grade, studentContent: studentContent, validateContent: validateContent, normText: normText };
})();
if (typeof module !== 'undefined') module.exports = SECore;
