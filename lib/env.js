/* Mencari kunci Supabase di environment Vercel, apa pun prefix-nya
 * (mis. SUPABASE_URL, STORAGE_SUPABASE_URL, STORAGE_URL). */
'use strict';
function entries() { return Object.keys(process.env).map(k => [k, String(process.env[k] || '').trim()]).filter(e => e[1]); }
function bySuffix(suffixes, test) {
  const es = entries();
  for (const s of suffixes) {
    const hit = es.find(([k, v]) => (k === s || k.endsWith('_' + s)) && (!test || test(v)));
    if (hit) return hit[1];
  }
  return '';
}
function supabaseUrl() {
  return bySuffix(['SUPABASE_URL'], v => /^https?:\/\//.test(v)) ||
    (entries().find(([k, v]) => /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(v)) || [])[1] || '';
}
function supabaseKey() {
  const isSecret = v => /^sb_secret_/.test(v) || (/^eyJ/.test(v) && /service_role/.test(Buffer.from((v.split('.')[1] || ''), 'base64').toString()));
  return bySuffix(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SECRET_KEY', 'SERVICE_ROLE_KEY'], isSecret) ||
    (entries().find(([k, v]) => isSecret(v)) || [])[1] || '';
}
function postgresUrl() {
  return bySuffix(['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL', 'DATABASE_URL'], v => /^postgres(ql)?:\/\//.test(v)) ||
    (entries().find(([k, v]) => /^postgres(ql)?:\/\//.test(v)) || [])[1] || '';
}
module.exports = { supabaseUrl, supabaseKey, postgresUrl };
