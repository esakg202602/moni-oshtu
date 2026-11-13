import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD, INTEGRATION_KEY } = process.env;
const SECRET = process.env.SESSION_SECRET || 'dev-secret';
const TZH = +(process.env.TZ_OFFSET_H || 6);          // Бишкек = UTC+6
const PORT = process.env.PORT || 3000;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ADMIN_PASSWORD) {
  console.error('Задайте SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD'); process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const app = express();
app.use(express.json({ limit: '10mb' }));

/* ---------- утилиты ---------- */
const sig = p => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
const makeToken = () => { const e = String(Date.now() + 12 * 36e5); return e + '.' + sig(e); };
const valid = t => {
  const [e, s] = (t || '').split('.');
  return !!s && s.length === 64 && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(e))) && +e > Date.now();
};
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const h = f => (q, r) => f(q, r).catch(e => { console.error(e); r.status(500).json({ error: e.message }); });
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k] === '' ? null : o[k]]));
const dayStart = () => { const n = Date.now() + TZH * 36e5; return new Date(Math.floor(n / 864e5) * 864e5 - TZH * 36e5); };

/* ---------- статика (только 3 файла) ---------- */
app.get(['/', '/index.html'], (q, r) => r.sendFile(path.join(dir, 'index.html')));
app.get('/app.js', (q, r) => r.sendFile(path.join(dir, 'app.js')));
app.get('/styles.css', (q, r) => r.sendFile(path.join(dir, 'styles.css')));

/* ---------- интеграция с университетской системой баллов (по ключу) ---------- */
app.get('/api/integration/points', h(async (q, r) => {
  if (!INTEGRATION_KEY || q.get('x-api-key') !== INTEGRATION_KEY) return r.status(401).json({ error: 'bad key' });
  r.json(must(await db.from('people').select('id,external_id,full_name,group_name,rating_points,module_points').eq('role', 'student')));
}));

/* ---------- авторизация ---------- */
app.post('/api/login', (q, r) => {
  if (q.body.password === ADMIN_PASSWORD) return r.json({ token: makeToken() });
  r.status(401).json({ error: 'Неверный пароль' });
});
app.use('/api', (q, r, n) => valid((q.get('authorization') || '').slice(7)) ? n() : r.status(401).json({ error: 'auth' }));

/* ---------- баллы ---------- */
async function addPoints(v) {
  const p = must(await db.from('people').select('rating_points,module_points').eq('id', v.person_id).single());
  const upd = {};
  if (v.target !== 'module') upd.rating_points = +p.rating_points + +v.points;
  if (v.target !== 'rating') upd.module_points = +p.module_points + +v.points;
  must(await db.from('people').update(upd).eq('id', v.person_id));
  must(await db.from('point_log').insert({ person_id: v.person_id, violation_id: v.id || null, delta: v.points, target: v.target, reason: v.reason || v.state }));
}

async function applyRule(person_id, lesson_id, state, seconds, extra = {}) {
  const p = must(await db.from('people').select('role').eq('id', person_id).single());
  const rules = must(await db.from('rules').select('*').eq('state', state).eq('active', true));
  const rule = rules.find(x => x.role === p.role) || rules.find(x => x.role === 'both');
  if (!rule || seconds < rule.min_seconds) return null;
  const extraMin = state === 'late' ? Math.max(0, (extra.late_minutes || 1) - 1)
    : state === 'absent' ? 0 : Math.floor((seconds - rule.min_seconds) / 60);
  const pts = +rule.base_points + +rule.per_minute_points * extraMin;
  if (!pts) return null;
  const v = must(await db.from('violations').insert({
    person_id, lesson_id, rule_id: rule.id, state, seconds: Math.round(seconds), points: pts,
    target: rule.target, status: rule.auto_apply ? 'applied' : 'pending',
    reviewed_at: rule.auto_apply ? new Date().toISOString() : null
  }).select().single());
  if (rule.auto_apply) await addPoints(v);
  return v;
}

/* ---------- люди ---------- */
const PF = ['role', 'full_name', 'group_name', 'phone', 'external_id', 'consent'];
app.get('/api/people', h(async (q, r) => r.json(must(await db.from('people')
  .select('id,role,full_name,group_name,phone,external_id,consent,descriptor_count,rating_points,module_points').order('full_name')))));
app.post('/api/people', h(async (q, r) => r.json(must(await db.from('people').insert(pick(q.body, PF)).select().single()))));
app.post('/api/people/bulk', h(async (q, r) => {
  const { role = 'student', group_name, lines = [] } = q.body;
  const rows = lines.filter(l => l.full_name && l.full_name.trim())
    .map(l => ({ role, group_name: group_name || null, full_name: l.full_name.trim(), phone: l.phone || null }));
  r.json({ added: rows.length ? must(await db.from('people').insert(rows).select('id')).length : 0 });
}));
app.put('/api/people/:id', h(async (q, r) => r.json(must(await db.from('people').update(pick(q.body, PF)).eq('id', q.params.id).select().single()))));
app.delete('/api/people/:id', h(async (q, r) => { must(await db.from('people').delete().eq('id', q.params.id)); r.json({ ok: 1 }); }));
app.post('/api/people/:id/samples', h(async (q, r) => {
  const p = must(await db.from('people').select('descriptors,appearance').eq('id', q.params.id).single());
  const d = [...(p.descriptors || []), ...(q.body.descriptors || [])].slice(-40);
  const a = [...(p.appearance || []), ...(q.body.appearance || [])].slice(-30);
  must(await db.from('people').update({ descriptors: d, appearance: a, descriptor_count: d.length }).eq('id', q.params.id));
  r.json({ count: d.length });
}));
app.get('/api/recognition', h(async (q, r) => r.json(must(await db.from('people')
  .select('id,role,full_name,group_name,descriptors,appearance').eq('consent', true).gt('descriptor_count', 0)))));

/* ---------- занятия ---------- */
const LF = ['title', 'group_name', 'teacher_id', 'room', 'starts_at', 'ends_at', 'grace_min', 'status'];
app.get('/api/lessons', h(async (q, r) => {
  let qq = db.from('lessons').select('*,teacher:teacher_id(full_name)').gte('starts_at', new Date(q.query.from || dayStart()).toISOString()).order('starts_at', { ascending: false });
  if (q.query.to) qq = qq.lte('starts_at', new Date(q.query.to).toISOString());
  r.json(must(await qq));
}));
app.post('/api/lessons', h(async (q, r) => r.json(must(await db.from('lessons').insert(pick(q.body, LF)).select().single()))));
app.put('/api/lessons/:id', h(async (q, r) => r.json(must(await db.from('lessons').update(pick(q.body, LF)).eq('id', q.params.id).select().single()))));
app.delete('/api/lessons/:id', h(async (q, r) => { must(await db.from('lessons').delete().eq('id', q.params.id)); r.json({ ok: 1 }); }));
app.get('/api/lessons/:id/roster', h(async (q, r) => {
  const lesson = must(await db.from('lessons').select('*').eq('id', q.params.id).single());
  const people = must(await db.from('people').select('id,full_name,role,group_name').eq('group_name', lesson.group_name || '').eq('role', 'student').order('full_name'));
  if (lesson.teacher_id) people.unshift(must(await db.from('people').select('id,full_name,role,group_name').eq('id', lesson.teacher_id).single()));
  const attendance = must(await db.from('attendance').select('*').eq('lesson_id', lesson.id));
  r.json({ lesson, people, attendance });
}));
app.post('/api/lessons/:id/start', h(async (q, r) => {
  must(await db.from('lessons').update({ status: 'running' }).eq('id', q.params.id).neq('status', 'closed')); r.json({ ok: 1 });
}));
app.post('/api/lessons/:id/close', h(async (q, r) => {
  const L = must(await db.from('lessons').select('*').eq('id', q.params.id).single());
  if (L.status === 'closed') return r.json({ absent: 0 });
  const stu = must(await db.from('people').select('id').eq('group_name', L.group_name || '').eq('role', 'student'));
  const seen = new Set(must(await db.from('attendance').select('person_id').eq('lesson_id', L.id)).map(a => a.person_id));
  const missing = [...stu.map(s => s.id), ...(L.teacher_id ? [L.teacher_id] : [])].filter(id => !seen.has(id));
  for (const id of missing) {
    must(await db.from('attendance').insert({ lesson_id: L.id, person_id: id, status: 'absent' }));
    await applyRule(id, L.id, 'absent', 0);
  }
  must(await db.from('lessons').update({ status: 'closed' }).eq('id', L.id));
  r.json({ absent: missing.length });
}));
app.get('/api/lessons/:id/summary', h(async (q, r) => {
  const rows = must(await db.from('activity_log').select('person_id,state,duration_s,person:person_id(full_name)').eq('lesson_id', q.params.id).limit(20000));
  const att = must(await db.from('attendance').select('*,person:person_id(full_name)').eq('lesson_id', q.params.id));
  const by = {};
  for (const x of rows) { const o = by[x.person_id] ||= { name: x.person?.full_name, states: {} }; o.states[x.state] = (o.states[x.state] || 0) + x.duration_s; }
  r.json({ people: Object.values(by), attendance: att });
}));

/* ---------- посещаемость и активность (шлёт камера) ---------- */
app.post('/api/attendance/seen', h(async (q, r) => {
  const { lesson_id, person_id } = q.body;
  const ex = must(await db.from('attendance').select('*').eq('lesson_id', lesson_id).eq('person_id', person_id).maybeSingle());
  if (ex && ex.status !== 'absent') return r.json(ex);
  const L = must(await db.from('lessons').select('*').eq('id', lesson_id).single());
  const now = new Date();
  const late = Math.max(0, Math.floor((now - new Date(L.starts_at)) / 60000) - L.grace_min + 1);
  const row = { lesson_id, person_id, first_seen: now.toISOString(), status: late > 0 ? 'late' : 'present', late_minutes: late };
  const att = ex ? must(await db.from('attendance').update(row).eq('id', ex.id).select().single())
                 : must(await db.from('attendance').insert(row).select().single());
  if (late > 0) await applyRule(person_id, lesson_id, 'late', late * 60, { late_minutes: late });
  r.json(att);
}));
app.post('/api/activity', h(async (q, r) => {
  const { lesson_id, segments = [] } = q.body;
  const rows = segments.filter(s => s.person_id && s.state).map(s => ({
    lesson_id, person_id: s.person_id, state: s.state, started_at: s.started_at, ended_at: s.ended_at,
    duration_s: Math.max(0, Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 1000)), confidence: s.confidence ?? null
  }));
  if (rows.length) must(await db.from('activity_log').insert(rows));
  let v = 0;
  for (const s of rows) if (await applyRule(s.person_id, lesson_id, s.state, s.duration_s)) v++;
  r.json({ saved: rows.length, violations: v });
}));

/* ---------- обученная модель взгляда комнаты ---------- */
app.get('/api/room-model', h(async (q, r) => {
  const d = must(await db.from('room_model').select('samples').eq('room', q.query.room || '').maybeSingle());
  r.json({ samples: d?.samples || [] });
}));
app.put('/api/room-model', h(async (q, r) => {
  must(await db.from('room_model').upsert({ room: q.body.room || '', samples: q.body.samples || [], updated_at: new Date().toISOString() }));
  r.json({ ok: 1 });
}));

/* ---------- нарушения, баллы, правила ---------- */
app.get('/api/violations', h(async (q, r) => r.json(must(await db.from('violations')
  .select('*,person:person_id(full_name,group_name),lesson:lesson_id(title)')
  .eq('status', q.query.status || 'pending').order('created_at', { ascending: false }).limit(300)))));
app.post('/api/violations/:id/review', h(async (q, r) => {
  const v = must(await db.from('violations').select('*').eq('id', q.params.id).single());
  if (v.status !== 'pending') return r.status(400).json({ error: 'Уже обработано' });
  const ok = q.body.action === 'approve';
  must(await db.from('violations').update({ status: ok ? 'applied' : 'rejected', reviewed_at: new Date().toISOString() }).eq('id', v.id));
  if (ok) await addPoints(v);
  r.json({ ok: 1 });
}));
app.post('/api/points', h(async (q, r) => {
  const { person_id, delta, target = 'both', reason = 'Ручная корректировка' } = q.body;
  await addPoints({ person_id, points: +delta, target, reason }); r.json({ ok: 1 });
}));
app.get('/api/rules', h(async (q, r) => r.json(must(await db.from('rules').select('*').order('role').order('state')))));
app.put('/api/rules/:id', h(async (q, r) => r.json(must(await db.from('rules').update(
  pick(q.body, ['label', 'role', 'min_seconds', 'base_points', 'per_minute_points', 'target', 'auto_apply', 'active'])).eq('id', q.params.id).select().single()))));

/* ---------- панель и отчёты ---------- */
app.get('/api/dashboard', h(async (q, r) => {
  const t0 = dayStart().toISOString(), w = new Date(Date.now() - 7 * 864e5).toISOString();
  const ids = must(await db.from('lessons').select('id').gte('starts_at', t0)).map(l => l.id);
  const att = ids.length ? must(await db.from('attendance').select('status').in('lesson_id', ids)) : [];
  const cnt = s => att.filter(a => a.status === s).length;
  const pending = (await db.from('violations').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count || 0;
  const logs = must(await db.from('point_log').select('person_id,delta,person:person_id(full_name,group_name)').lt('delta', 0).gte('created_at', w).limit(3000));
  const agg = {};
  for (const l of logs) { const o = agg[l.person_id] ||= { name: l.person?.full_name, group: l.person?.group_name, sum: 0 }; o.sum += +l.delta; }
  const top = Object.values(agg).sort((a, b) => a.sum - b.sum).slice(0, 8);
  const recent = must(await db.from('violations').select('*,person:person_id(full_name),lesson:lesson_id(title)').order('created_at', { ascending: false }).limit(10));
  r.json({ lessons: ids.length, present: cnt('present'), late: cnt('late'), absent: cnt('absent'), pending, top, recent });
}));
app.get('/api/people/:id/report', h(async (q, r) => {
  const id = q.params.id, since = new Date(Date.now() - 30 * 864e5).toISOString();
  const person = must(await db.from('people').select('id,full_name,role,group_name,rating_points,module_points').eq('id', id).single());
  const attendance = must(await db.from('attendance').select('*,lesson:lesson_id(title,starts_at)').eq('person_id', id).order('first_seen', { ascending: false, nullsFirst: false }).limit(60));
  const violations = must(await db.from('violations').select('*,lesson:lesson_id(title)').eq('person_id', id).order('created_at', { ascending: false }).limit(100));
  const act = must(await db.from('activity_log').select('state,duration_s').eq('person_id', id).gte('started_at', since).limit(10000));
  const totals = {}; for (const a of act) totals[a.state] = (totals[a.state] || 0) + a.duration_s;
  const points = must(await db.from('point_log').select('*').eq('person_id', id).order('created_at', { ascending: false }).limit(100));
  r.json({ person, attendance, violations, totals, points });
}));
app.get('/api/export/points.csv', h(async (q, r) => {
  const p = must(await db.from('people').select('full_name,group_name,external_id,rating_points,module_points').eq('role', 'student').order('group_name').order('full_name'));
  const csv = '\ufeffФИО;Группа;ID;Рейтинг;Модуль\n' + p.map(x => [x.full_name, x.group_name, x.external_id, x.rating_points, x.module_points].map(v => `"${v ?? ''}"`).join(';')).join('\n');
  r.type('text/csv').send(csv);
}));

app.listen(PORT, () => console.log('Campus Vision запущен на порту ' + PORT));
