import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run, tx, getSettings, setSettings, audit, randomToken, ensureTableTokens } from './db.js';
import { authenticate, allow, signToken, ROLES } from './auth.js';
import { need, hasPerm, PERMISSIONS, ROLES_EDITABLE, DEFAULTS, rolePerms, setRolePerms, resetRolePerms, usersWithPerm } from './perms.js';
import { bad, notFound, pick, updateSql, normalize, round2, today } from './util.js';
import * as Orders from './orders.js';
import { hrRoutes } from './hr.js';
import { attendanceRoutes, attendanceGate } from './attendance.js';
import { setNotifyEmitter, notify, pushEnabled, webPushKey, customerNotify } from './notify.js';

/**
 * @param {(event: string, payload?: any) => void} emit إرسال حدث لحظي لكل الأجهزة
 */
export function buildRouter(emit) {
  const r = Router();
  const changed = (...events) => events.forEach((e) => emit(e));
  setNotifyEmitter(emit);

  // ───────────── المصادقة ─────────────
  r.get('/health', (req, res) => res.json({ ok: true, name: getSettings().restaurant_name }));

  r.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = get('SELECT * FROM users WHERE username = ?', String(username || '').trim());
    if (!user || !user.active || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    audit(user.id, 'auth.login');
    res.json({ token: signToken(user), user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  });

  // ───────────── الطلب من رمز QR الطاولة (بلا تسجيل دخول) ─────────────
  // الرمز عشوائي (96 بت) خاص بطاولة واحدة؛ لا يوجد رابط عام للطلب، ويمكن تغيير رمز أي طاولة لإبطال البطاقة القديمة.
  ensureTableTokens();
  const hits = new Map();
  const limited = (req, key, max, windowMs) => {
    const ip = String(req.headers?.['x-forwarded-for'] || req.ip || 'local').split(',')[0].trim();
    const k = `${key}:${ip}`;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(kk);
    return arr.length > max;
  };
  const onlineOn = () => getSettings().online_ordering === '1';
  const clip = (v, n) => String(v ?? '').trim().slice(0, n);
  const PUBLIC_USER = { id: null, name: 'الزبون (رمز الطاولة)', role: 'public' };
  const ipOf = (req) => String(req.headers?.['x-forwarded-for'] || req.ip || 'local').split(',')[0].trim();
  const digitsOf = (p) => String(p || '').replace(/[^0-9]/g, '');

  // سجل محاولات QR + تنبيه المدير عند الأنماط المشبوهة (مع تهدئة 30 دقيقة لكل نمط)
  const alerted = new Map();
  const qrLog = (req, tableId, event, detail = null, deviceId = null) => {
    run('INSERT INTO qr_log(ip, device_id, table_id, event, detail) VALUES(?,?,?,?,?)', ipOf(req), deviceId || null, tableId || null, event, detail);
    if (Math.random() < 0.02) run("DELETE FROM qr_log WHERE at < datetime('now','localtime','-14 days')");
  };
  const qrAlert = (key, title, body) => {
    const now = Date.now();
    if (now - (alerted.get(key) || 0) < 30 * 60 * 1000) return;
    alerted.set(key, now);
    notify({ perms: ['settings.manage'], roles: ['admin'], type: 'qr_alert', level: 'warning', link: '/settings', title, body });
  };
  const recent = '10 minutes';
  const tableByToken = (req, deviceId = null) => {
    if (limited(req, 'tk', 60, 60 * 1000)) throw Object.assign(bad('طلبات كثيرة، حاول بعد قليل'), { status: 429 });
    const tok = String(req.params.token || '');
    const t = tok.length >= 16 ? get('SELECT id, name, seats, area, qr_open_until FROM dining_tables WHERE qr_token = ? AND active = 1', tok) : null;
    if (!t) {
      qrLog(req, null, 'bad_token', tok.slice(0, 12));
      const n = get(`SELECT COUNT(*) AS c FROM qr_log WHERE event = 'bad_token' AND ip = ? AND at > datetime('now','localtime','-${recent}')`, ipOf(req)).c;
      if (n >= 5) qrAlert(`bad:${ipOf(req)}`, 'محاولات رموز QR خاطئة متكررة', `${n} محاولة برمز غير صالح خلال 10 دقائق من نفس العنوان (${ipOf(req)}). قد يكون تخميناً للرموز.`);
      throw notFound('رمز الطاولة غير صالح');
    }
    if (deviceId) {
      const n = get(`SELECT COUNT(DISTINCT table_id) AS c FROM qr_log WHERE event = 'scan' AND device_id = ? AND at > datetime('now','localtime','-${recent}')`, deviceId).c;
      if (n >= 3) qrAlert(`dev:${deviceId}`, 'جهاز يمسح عدة طاولات', `جهاز واحد مسح ${n + 1} طاولات مختلفة خلال 10 دقائق (آخرها ${t.name}). راجع سجل QR في الإعدادات.`);
    }
    return t;
  };
  const isOpenNow = (t) => !!get("SELECT 1 AS x FROM dining_tables WHERE id = ? AND qr_open_until > datetime('now','localtime')", t.id);
  const tableOpen = (t) => getSettings().qr_require_open !== '1' || isOpenNow(t);

  r.get('/public/table/:token', (req, res) => {
    const dev = clip(req.query.d, 40);
    const t = tableByToken(req, dev);
    if (dev) qrLog(req, t.id, 'scan', null, dev);
    const s = getSettings();
    const open = get("SELECT id, code, source, track_token FROM orders WHERE table_id = ? AND status = 'open'", t.id);
    res.json({
      enabled: s.online_ordering === '1',
      name: s.restaurant_name, currency: s.currency, phone: s.phone,
      table: { name: t.name, seats: t.seats, area: t.area, busy: !!open, open: tableOpen(t) },
      // الطلب المفتوح من هذا الرمز (لإتاحة الإضافة عليه لمن يملك رمز متابعته فقط)
      open_code: open?.source === 'online' ? open.code : null,
      bill_allowed: s.qr_allow_bill === '1',
    });
  });

  r.get('/public/table/:token/menu', (req, res) => {
    tableByToken(req);
    if (!onlineOn()) return res.status(403).json({ error: 'الطلب عبر QR متوقف حالياً', reason: 'disabled' });
    const categories = all('SELECT id, name, icon FROM categories WHERE active = 1 ORDER BY sort, id');
    const items = all('SELECT id, category_id, name, description, price, image, available FROM menu_items WHERE active = 1 ORDER BY sort, id');
    const mods = all('SELECT id, item_id, name, price FROM modifiers ORDER BY id');
    for (const it of items) it.modifiers = mods.filter((m) => m.item_id === it.id).map(({ id, name, price }) => ({ id, name, price }));
    res.json({ categories, items });
  });

  // الزبون يطلب من النادل فتح الطاولة للطلب بالـ QR: إشعار للنادل والمدير + علامة على بطاقة الطاولة
  r.post('/public/table/:token/request-open', (req, res) => {
    const dev = clip(req.body?.device_id, 40);
    const t = tableByToken(req);
    if (!onlineOn()) return res.status(403).json({ error: 'الطلب عبر QR متوقف حالياً', reason: 'disabled' });
    if (limited(req, 'ro', 6, 10 * 60 * 1000)) return res.status(429).json({ error: 'تم إرسال الطلب، انتظر النادل قليلاً' });
    if (tableOpen(t) || get("SELECT 1 AS x FROM orders WHERE table_id = ? AND status = 'open'", t.id)) return res.json({ ok: true, open: true });
    const recent = get("SELECT 1 AS x FROM dining_tables WHERE id = ? AND qr_request_at > datetime('now','localtime','-60 seconds')", t.id);
    if (recent) return res.json({ ok: true, already: true });
    run("UPDATE dining_tables SET qr_request_at = datetime('now','localtime') WHERE id = ?", t.id);
    qrLog(req, t.id, 'open_request', null, dev);
    audit(null, 'qr.request_open', 'table', t.id, { name: t.name });
    notify({ perms: ['pos.create', 'payments.collect'], roles: ['admin', 'manager'], type: 'qr_request', level: 'warning', link: `/tables?table=${t.id}`, title: `${t.name} تطلب فتح الطلب بالـ QR`, body: 'الزبون على الطاولة يريد الطلب من هاتفه. افتح الطاولة من صفحة الطاولات.' });
    changed('tables');
    res.json({ ok: true });
  });

  r.post('/public/table/:token/orders', (req, res) => {
    const b = req.body || {};
    const dev = clip(b.device_id, 40);
    const t = tableByToken(req, dev);
    if (!onlineOn()) return res.status(403).json({ error: 'الطلب عبر QR متوقف حالياً', reason: 'disabled' });
    if (limited(req, 'po', Number(globalThis.process?.env?.QR_RATE_LIMIT) || 8, 10 * 60 * 1000)) { qrLog(req, t.id, 'rate_limited', null, dev); return res.status(429).json({ error: 'طلبات كثيرة، حاول بعد قليل' }); }
    const s = getSettings();
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw bad('أضف أصنافاً للطلب');
    if (items.length > 40 || items.reduce((a, i) => a + Math.min(Number(i.qty) || 1, 99), 0) > 80) throw bad('عدد الأصناف كبير جداً، نادِ النادل');
    const lines = items.map((i) => ({ item_id: Number(i.item_id), qty: Math.min(Math.max(parseInt(i.qty, 10) || 1, 1), 20), modifier_ids: Array.isArray(i.modifier_ids) ? i.modifier_ids.slice(0, 10).map(Number) : [], notes: clip(i.notes, 100) || null }));
    const open = get("SELECT * FROM orders WHERE table_id = ? AND status = 'open'", t.id);
    const phone = clip(b.customer_phone, 20);
    let id; let added = false; let before = 0;
    if (open) {
      // إضافة على طلب الطاولة المفتوح: لا تُقبل إلا بشرط أن يكون طلباً من الرمز ومع رمز متابعته
      if (open.source !== 'online' || !open.track_token || open.track_token !== String(b.order_token || '')) throw bad('الطاولة عليها طلب مفتوح، نادِ النادل لإضافة أصناف');
      if (open.bill_requested_at) throw bad('تم طلب الحساب لهذه الطاولة، نادِ النادل لإضافة أصناف');
      id = open.id; added = true; before = open.subtotal;
      Orders.addItems(id, lines, PUBLIC_USER);
    } else {
      // 1) الطاولة يجب أن يفتحها النادل أولاً
      if (!tableOpen(t)) {
        qrLog(req, t.id, 'closed_attempt', null, dev);
        const n = get(`SELECT COUNT(*) AS c FROM qr_log WHERE event = 'closed_attempt' AND (device_id = ? OR ip = ?) AND at > datetime('now','localtime','-${recent}')`, dev || '-', ipOf(req)).c;
        if (n >= 3) qrAlert(`closed:${dev || ipOf(req)}`, 'محاولات طلب على طاولة غير مفتوحة', `${n} محاولة طلب على طاولات لم تُفتح لـ QR خلال 10 دقائق (آخرها ${t.name}). قد يكون طلباً من خارج المطعم.`);
        return res.status(403).json({ error: 'هذه الطاولة لم تُفتح للطلب بعد، نادِ النادل ليفعّلها', reason: 'table_closed' });
      }
      // 2) طلب مفتوح واحد لكل جوال / جهاز
      const dg = digitsOf(phone);
      const dup = get(`SELECT d.name AS tname FROM orders o LEFT JOIN dining_tables d ON d.id = o.table_id
        WHERE o.status = 'open' AND ((? != '' AND o.device_id = ?) OR (? != '' AND REPLACE(REPLACE(REPLACE(o.customer_phone,' ',''),'-',''),'+','') = ?)) LIMIT 1`, dev, dev, dg, dg);
      if (dup) {
        qrLog(req, t.id, 'dup_open', dup.tname, dev);
        throw bad(`لديك طلب مفتوح${dup.tname ? ` على ${dup.tname}` : ''}، أضف عليه أو نادِ النادل`);
      }
      const token = randomToken();
      id = Orders.createOrder({
        type: 'dine_in', table_id: t.id, guests: Math.min(Math.max(parseInt(b.guests, 10) || 1, 1), 30),
        customer_name: clip(b.customer_name, 60), customer_phone: phone, notes: clip(b.notes, 300) || null, items: lines,
      }, PUBLIC_USER);
      run("UPDATE orders SET source = 'online', track_token = ?, device_id = ? WHERE id = ?", token, dev || null, id);
      const opener = get("SELECT u.id, u.name FROM dining_tables d JOIN users u ON u.id = d.qr_opened_by WHERE d.id = ? AND d.qr_open_until > datetime('now','localtime')", t.id);
      if (opener) run('UPDATE orders SET waiter_id = ? WHERE id = ?', opener.id, id);   // النادل الذي فتح الطاولة هو مسؤول الطلب
      Orders.logEvent(id, 'online', null, opener ? `طلب من رمز QR الطاولة (فتحها ${opener.name})` : 'طلب من رمز QR الطاولة', { opened_by: opener?.name || null });
    }
    const o0 = Orders.getOrder(id);
    const newValue = o0.subtotal - before;
    // 3) تأكيد النادل: دائماً، أو (ذكي) إذا زاد المبلغ عن الحد أو كان أول طلب لهذا الجوال
    const mode = s.qr_confirm_mode;
    const firstTime = !added && !get("SELECT 1 AS x FROM orders WHERE status = 'paid' AND customer_phone = ?", phone);
    const needsConfirm = mode === 'always' || (mode !== 'never' && (newValue > (Number(s.qr_confirm_over) || 0) || firstTime));
    const { where } = Orders.orderLabel(id);
    const o = Orders.getOrder(id);
    if (needsConfirm) {
      run('UPDATE orders SET pending_confirm = 1 WHERE id = ?', id);
      qrLog(req, t.id, 'confirm_required', `${o.code} · ${newValue}`, dev);
      notify({ perms: ['pos.create', 'payments.collect'], type: 'online_confirm', level: 'warning', link: `/pos/${id}`, title: `طلب QR بانتظار التأكيد · ${where}`, body: `${o.code} · ${o.items.length} صنف · ${newValue}${firstTime ? ' · أول طلب لهذا الجوال' : ''}` });
    } else {
      Orders.sendToKitchen(id, PUBLIC_USER);
      notify({ perms: ['payments.collect', 'pos.create'], type: 'online_order', level: 'info', link: `/pos/${id}`, title: `${added ? 'إضافة على' : 'طلب جديد من'} ${where} (QR) ${o.code}`, body: `${o.items.length} صنف · ${o.total}` });
    }
    qrLog(req, t.id, 'order', `${o.code}${added ? ' (إضافة)' : ''}${needsConfirm ? ' · بانتظار التأكيد' : ''}`, dev);
    audit(null, 'qr.order', 'order', id, { table: t.name, added, items: lines.reduce((a, l) => a + l.qty, 0), total: o.total, needs_confirm: needsConfirm, waiter: o.waiter_name || null, customer: o.customer_name || null });
    changed('orders', 'kitchen', 'tables');
    emit('public-order', id);
    res.status(201).json({ code: o.code, token: get('SELECT track_token FROM orders WHERE id = ?', id).track_token, total: o.total, added, needs_confirm: needsConfirm });
  });

  // ───────────── QR المؤسسة (فعالية): موظفو مؤسسة استأجرت المكان يطلبون من قائمة محددة ─────────────
  const eventState = (ev) => {
    if (!ev.active) return 'paused';
    const now = get("SELECT datetime('now','localtime') AS n").n;
    return now < ev.starts_at ? 'not_started' : now > ev.ends_at ? 'ended' : 'open';
  };
  const eventByToken = (req) => {
    if (limited(req, 'ev', 90, 60 * 1000)) throw Object.assign(bad('طلبات كثيرة، حاول بعد قليل'), { status: 429 });
    const tok = String(req.params.token || '');
    const ev = tok.length >= 16 ? get('SELECT * FROM events WHERE token = ?', tok) : null;
    if (!ev) { qrLog(req, null, 'bad_token', `event:${tok.slice(0, 10)}`); throw notFound('رمز المؤسسة غير صالح'); }
    return ev;
  };
  const evPublic = (ev) => ({
    name: ev.name, state: eventState(ev), starts_at: ev.starts_at, ends_at: ev.ends_at, menu_mode: ev.menu_mode,
    price_cap: ev.menu_mode === 'cap' ? ev.price_cap : null, order_cap: ev.order_cap, billing: ev.billing, needs_approval: !!ev.needs_approval,
    places: ev.places ? JSON.parse(ev.places) : [],
    welcome_message: ev.welcome_message || null, support_phone: ev.support_phone || null, support_chat: !!ev.support_chat,
  });
  const eventMenu = (ev) => {
    const mods = all('SELECT id, item_id, name, price FROM modifiers ORDER BY id');
    let items = all('SELECT id, category_id, name, description, price, image, available FROM menu_items WHERE active = 1 ORDER BY sort, id');
    if (ev.menu_mode === 'selected') { const ok = new Set(all('SELECT item_id FROM event_items WHERE event_id = ?', ev.id).map((x) => x.item_id)); items = items.filter((i) => ok.has(i.id)); }
    else if (ev.menu_mode === 'cap') items = items.filter((i) => i.price <= ev.price_cap);
    for (const it of items) it.modifiers = mods.filter((m) => m.item_id === it.id).map(({ id, name, price }) => ({ id, name, price }));
    const cats = new Set(items.map((i) => i.category_id));
    return { categories: all('SELECT id, name, icon FROM categories WHERE active = 1 ORDER BY sort, id').filter((c) => cats.has(c.id)), items };
  };

  r.get('/public/event/:token', (req, res) => {
    const ev = eventByToken(req);
    const s = getSettings();
    res.json({ enabled: s.online_ordering === '1', restaurant: s.restaurant_name, currency: s.currency, phone: s.phone, event: evPublic(ev) });
  });
  r.get('/public/event/:token/menu', (req, res) => {
    const ev = eventByToken(req);
    if (!onlineOn()) return res.status(403).json({ error: 'الطلب عبر QR متوقف حالياً', reason: 'disabled' });
    if (eventState(ev) !== 'open') return res.status(403).json({ error: 'الطلب غير متاح الآن لهذه الفعالية', reason: eventState(ev) });
    res.json(eventMenu(ev));
  });
  r.post('/public/event/:token/orders', (req, res) => {
    const ev = eventByToken(req);
    if (!onlineOn()) return res.status(403).json({ error: 'الطلب عبر QR متوقف حالياً', reason: 'disabled' });
    if (eventState(ev) !== 'open') return res.status(403).json({ error: 'الطلب غير متاح الآن لهذه الفعالية', reason: eventState(ev) });
    if (limited(req, 'eo', Number(globalThis.process?.env?.QR_RATE_LIMIT) || 20, 10 * 60 * 1000)) return res.status(429).json({ error: 'طلبات كثيرة، حاول بعد قليل' });
    const b = req.body || {};
    const dev = clip(b.device_id, 40);
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw bad('أضف أصنافاً للطلب');
    if (items.length > 30 || items.reduce((a, i) => a + Math.min(Number(i.qty) || 1, 99), 0) > 60) throw bad('عدد الأصناف كبير جداً');
    const lines = items.map((i) => ({ item_id: Number(i.item_id), qty: Math.min(Math.max(parseInt(i.qty, 10) || 1, 1), 20), modifier_ids: Array.isArray(i.modifier_ids) ? i.modifier_ids.slice(0, 10).map(Number) : [], notes: clip(i.notes, 100) || null }));
    // قائمة المؤسسة وسقف السعر وسقف الطلب
    const allowed = ev.menu_mode === 'selected' ? new Set(all('SELECT item_id FROM event_items WHERE event_id = ?', ev.id).map((x) => x.item_id)) : null;
    let est = 0;
    for (const l of lines) {
      const it = get('SELECT id, name, price FROM menu_items WHERE id = ? AND active = 1', l.item_id);
      if (!it) throw bad('الصنف غير موجود');
      if (allowed && !allowed.has(it.id)) throw bad(`«${it.name}» ليس ضمن قائمة المؤسسة`);
      if (ev.menu_mode === 'cap' && it.price > ev.price_cap) throw bad(`«${it.name}» أعلى من السقف المسموح (${ev.price_cap})`);
      const mp = l.modifier_ids.length ? all(`SELECT price FROM modifiers WHERE item_id = ? AND id IN (${l.modifier_ids.map(() => '?').join(',')})`, it.id, ...l.modifier_ids).reduce((a, m) => a + m.price, 0) : 0;
      est += (it.price + mp) * l.qty;
    }
    const place = clip(b.place, 40);
    const places = ev.places ? JSON.parse(ev.places) : [];
    // الإضافة على طلب قائم مسموحة خلال 12 ساعة فقط؛ بعدها تُعدّ زيارة جديدة
    const open = b.order_token ? get("SELECT * FROM orders WHERE track_token = ? AND event_id = ? AND status = 'open' AND created_at > datetime('now','localtime','-12 hours')", String(b.order_token), ev.id) : null;
    // الإضافة على طلب قائم تستخدم مكانه الأصلي فلا يُطلب المكان مجدداً
    if (!open && places.length && !places.includes(place)) throw bad('اختر مكانك من القائمة');
    const before = open ? open.subtotal : 0;
    if (ev.order_cap && before + est > ev.order_cap + 0.001) throw bad(`تجاوز سقف الطلب الواحد (${ev.order_cap})`);
    let id; let added = false;
    if (open) { id = open.id; added = true; Orders.addItems(id, lines, PUBLIC_USER); }
    else {
      id = Orders.createOrder({ type: 'dine_in', event_id: ev.id, place: place || null, customer_name: clip(b.customer_name, 60), customer_phone: clip(b.customer_phone, 20), notes: clip(b.notes, 300) || null, items: lines }, PUBLIC_USER);
      run("UPDATE orders SET source = 'online', track_token = ?, device_id = ? WHERE id = ?", randomToken(), dev || null, id);
      Orders.logEvent(id, 'online', null, `طلب من فعالية «${ev.name}»${place ? ` · ${place}` : ''}`, { event: ev.name });
    }
    const o = Orders.getOrder(id);
    const { where } = Orders.orderLabel(id);
    if (ev.needs_approval) {
      run('UPDATE orders SET pending_confirm = 1 WHERE id = ?', id);
      notify({ perms: ['pos.create', 'payments.collect'], roles: ['admin', 'manager'], type: 'online_confirm', level: 'warning', link: `/pos/${id}`, title: `طلب مؤسسة بانتظار التأكيد · ${where}`, body: `${o.code} · ${o.items.length} صنف · ${o.customer_name}` });
    } else {
      Orders.sendToKitchen(id, PUBLIC_USER);
      notify({ perms: ['pos.create', 'payments.collect'], roles: ['admin', 'manager'], type: 'online_order', level: 'info', link: `/pos/${id}`, title: `${added ? 'إضافة على' : 'طلب جديد من'} ${where} ${o.code}`, body: `${o.customer_name} · ${o.items.length} صنف · ${o.total}` });
    }
    audit(null, 'event.order', 'order', id, { event: ev.name, place: place || null, customer: o.customer_name, items: lines.reduce((a, l) => a + l.qty, 0), total: o.total, added, needs_confirm: !!ev.needs_approval });
    changed('orders', 'kitchen', 'tables');
    emit('public-order', id);
    res.status(201).json({ code: o.code, token: get('SELECT track_token FROM orders WHERE id = ?', id).track_token, total: o.total, added, needs_confirm: !!ev.needs_approval });
  });

  // إشعارات Web Push للزبون (تصله حتى لو أغلق الصفحة)
  r.get('/public/push/key', (req, res) => res.json({ enabled: !!webPushKey(), key: webPushKey() }));
  r.post('/public/orders/:code/push', (req, res) => {
    if (limited(req, 'wp', 30, 10 * 60 * 1000)) return res.status(429).json({ error: 'طلبات كثيرة، حاول بعد قليل' });
    if (!webPushKey()) return res.status(503).json({ error: 'الإشعارات غير متاحة على هذا الخادم' });
    const o = get("SELECT id, track_token, status FROM orders WHERE code = ? AND source = 'online'", String(req.params.code));
    if (!o || !o.track_token || o.track_token !== String(req.query.t || '')) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (o.status !== 'open') throw bad('الطلب مغلق');
    const sub = req.body?.subscription || {};
    const endpoint = String(sub.endpoint || '');
    const p256dh = String(sub.keys?.p256dh || '');
    const auth = String(sub.keys?.auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 600 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw bad('اشتراك غير صالح');
    const url = /^https?:\/\//.test(String(req.body?.url || '')) ? String(req.body.url).slice(0, 400) : null;
    run('INSERT INTO web_push_subs(order_id, endpoint, p256dh, auth, url) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET order_id = excluded.order_id, p256dh = excluded.p256dh, auth = excluded.auth, url = excluded.url', o.id, endpoint, p256dh, auth, url);
    Orders.notifyCustomer(o.id, 'welcome');
    res.json({ ok: true });
  });

  // طلب الحساب من الزبون: طريقة الدفع (محفظة / بنك / جوال بي / نقداً) + الاسم ورقم الجوال → للكاشير
  const billOrder = (req) => {
    if (limited(req, 'bl', 20, 10 * 60 * 1000)) throw Object.assign(bad('طلبات كثيرة، حاول بعد قليل'), { status: 429 });
    if (!onlineOn() || getSettings().qr_allow_bill !== '1') throw bad('طلب الحساب من الهاتف غير متاح، نادِ النادل');
    const o = get("SELECT id, track_token FROM orders WHERE code = ? AND source = 'online'", String(req.params.code));
    if (!o || !o.track_token || o.track_token !== String(req.query.t || '')) throw notFound('الطلب غير موجود');
    return o;
  };
  r.post('/public/orders/:code/bill', (req, res) => {
    const o = billOrder(req);
    Orders.customerBill(o.id, { method: String(req.body?.method || ''), name: req.body?.name, phone: req.body?.phone });
    changed('orders', 'tables');
    emit('public-order', o.id);
    res.json({ ok: true, code: String(req.params.code) });
  });
  r.delete('/public/orders/:code/bill', (req, res) => {
    const o = billOrder(req);
    Orders.cancelCustomerBill(o.id);
    changed('orders', 'tables');
    emit('public-order', o.id);
    res.json({ ok: true });
  });

  r.get('/public/orders/:code', (req, res) => {
    if (limited(req, 'pg', 120, 60 * 1000)) return res.status(429).json({ error: 'طلبات كثيرة، حاول بعد قليل' });
    const o = get('SELECT * FROM orders WHERE code = ? AND source = ?', String(req.params.code), 'online');
    if (!o || !o.track_token || o.track_token !== String(req.query.t || '')) return res.status(404).json({ error: 'الطلب غير موجود' });
    const full = Orders.getOrder(o.id);
    res.json({
      code: full.code, status: full.status, table_name: full.table_name, total: full.total, created_at: full.created_at,
      event: full.event_name ? { name: full.event_name, billing: full.event_billing } : null, place: full.place || null,
      bill: full.bill_requested_at ? { at: full.bill_requested_at, method: full.bill_method, name: full.bill_name, phone: full.bill_phone } : null,
      pending_confirm: !!full.pending_confirm, cancel_reason: full.status === 'cancelled' ? full.cancel_reason : null,
      items: full.items.filter((i) => i.status !== 'cancelled').map((i) => ({ name: i.name, qty: i.qty, status: i.status })),
    });
  });

  // ───────────── خدمة العملاء: محادثة زبون المؤسسة مع المطعم ─────────────
  const devOf = (v) => { const d = clip(v, 40); if (d.length < 8) throw bad('جهاز غير معروف'); return d; };
  // الزبون يرى محادثة زيارته الحالية فقط (آخر 12 ساعة)؛ سجل الموظفين يحتفظ بكل الرسائل
  const chatRows = (eventId, dev) => all("SELECT id, sender, name, body, created_at FROM chat_messages WHERE event_id = ? AND device_id = ? AND created_at > datetime('now','localtime','-12 hours') ORDER BY id DESC LIMIT 200", eventId, dev).reverse();
  r.get('/public/event/:token/chat', (req, res) => {
    const ev = eventByToken(req);
    const dev = devOf(req.query.device_id);
    res.json({ enabled: !!ev.support_chat, messages: chatRows(ev.id, dev) });
  });
  r.post('/public/event/:token/chat', (req, res) => {
    const ev = eventByToken(req);
    if (!ev.support_chat) throw bad('المحادثة غير متاحة لهذه المؤسسة');
    if (limited(req, 'chat', Number(globalThis.process?.env?.QR_RATE_LIMIT) || 30, 10 * 60 * 1000)) return res.status(429).json({ error: 'رسائل كثيرة، حاول بعد قليل' });
    const dev = devOf(req.body?.device_id);
    const body = clip(req.body?.body, 500);
    if (!body) throw bad('اكتب رسالتك');
    const name = clip(req.body?.name, 60) || null;
    const id = Number(run('INSERT INTO chat_messages(event_id, device_id, sender, name, body) VALUES(?,?,?,?,?)', ev.id, dev, 'customer', name, body).lastInsertRowid);
    notify({ perms: ['chat.reply'], type: 'chat', title: `رسالة من ${name || 'زبون'} · ${ev.name}`, body: body.slice(0, 120), link: `/chat?e=${ev.id}&d=${encodeURIComponent(dev)}`, level: 'info' });
    emit('chat', { event_id: ev.id });
    emit('public-chat', `${ev.id}:${dev}`);
    res.status(201).json({ id, messages: chatRows(ev.id, dev) });
  });


  r.use(authenticate);
  r.use(attendanceGate);

  r.get('/auth/me', (req, res) => res.json(req.user));

  // ───────────── الصلاحيات ─────────────
  r.get('/permissions', allow(), (req, res) => {
    res.json({
      permissions: PERMISSIONS,
      roles: ROLES_EDITABLE.map((role) => ({ role, perms: rolePerms(role), defaults: DEFAULTS[role], customized: !!get('SELECT 1 AS x FROM role_permissions WHERE role = ?', role) })),
    });
  });
  r.put('/permissions/:role', allow(), (req, res) => {
    const role = req.params.role;
    if (!ROLES_EDITABLE.includes(role)) throw bad('لا يمكن تعديل صلاحيات هذا الدور');
    const before = rolePerms(role);
    let after;
    if (req.body?.reset) { resetRolePerms(role); after = rolePerms(role); } else {
      if (!Array.isArray(req.body?.perms)) throw bad('قائمة الصلاحيات غير صحيحة');
      after = setRolePerms(role, req.body.perms);
    }
    audit(req.user.id, 'permissions.update', 'role', null, { role, added: after.filter((k) => !before.includes(k)), removed: before.filter((k) => !after.includes(k)), reset: !!req.body?.reset });
    changed('permissions');
    res.json({ role, perms: after });
  });

  // ───────────── الإعدادات ─────────────
  r.get('/settings', (req, res) => res.json(getSettings()));
  r.put('/settings', need('settings.manage'), (req, res) => {
    const s = setSettings(req.body || {});
    audit(req.user.id, 'settings.update');
    changed('settings');
    res.json(s);
  });

  // ───────────── المستخدمون ─────────────
  r.get('/users', need('users.manage', 'hr.employees'), (req, res) => {
    res.json(all('SELECT id, name, username, role, active, created_at FROM users ORDER BY id'));
  });
  r.post('/users', need('users.manage'), (req, res) => {
    const { name, username, password, role } = req.body || {};
    if (!name || !username || !password) throw bad('أكمل البيانات');
    if (!ROLES.includes(role)) throw bad('الدور غير صحيح');
    if (role === 'admin' && req.user.role !== 'admin') throw bad('فقط المدير العام يمكنه إنشاء مدير عام');
    if (String(password).length < 4) throw bad('كلمة المرور قصيرة (4 أحرف على الأقل)');
    if (get('SELECT id FROM users WHERE username = ?', username)) throw bad('اسم المستخدم مستخدم مسبقاً');
    const info = run('INSERT INTO users(name, username, password_hash, role) VALUES(?,?,?,?)',
      name, username.trim(), bcrypt.hashSync(password, 10), role);
    audit(req.user.id, 'user.create', 'user', Number(info.lastInsertRowid));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/users/:id', need('users.manage'), (req, res) => {
    const id = Number(req.params.id);
    const fields = pick(req.body, ['name', 'role', 'active']);
    if (fields.role && !ROLES.includes(fields.role)) throw bad('الدور غير صحيح');
    const target = get('SELECT role FROM users WHERE id = ?', id);
    if (!target) throw notFound();
    if (req.user.role !== 'admin' && (target.role === 'admin' || fields.role === 'admin')) throw bad('لا يمكنك تعديل حساب المدير العام');
    if (id === req.user.id && (fields.active === false || fields.active === 0 || (fields.role && fields.role !== 'admin'))) {
      throw bad('لا يمكنك تعطيل حسابك أو تغيير دورك');
    }
    if (req.body.password) {
      if (String(req.body.password).length < 4) throw bad('كلمة المرور قصيرة');
      fields.password_hash = bcrypt.hashSync(req.body.password, 10);
    }
    const u = updateSql('users', fields, id);
    if (u) run(u.sql, ...u.params);
    audit(req.user.id, 'user.update', 'user', id, { ...fields, password_hash: undefined, password_changed: !!req.body.password });
    res.json({ ok: true });
  });

  // ───────────── قائمة الطعام ─────────────
  r.get('/menu', (req, res) => {
    const categories = all('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id');
    const items = all('SELECT * FROM menu_items WHERE active = 1 ORDER BY sort, id');
    const mods = all('SELECT * FROM modifiers ORDER BY id');
    for (const it of items) it.modifiers = mods.filter((m) => m.item_id === it.id);
    res.json({ categories, items });
  });

  r.post('/categories', need('menu.manage'), (req, res) => {
    const { name, icon, sort } = req.body || {};
    if (!name) throw bad('أدخل اسم الفئة');
    const info = run('INSERT INTO categories(name, icon, sort) VALUES(?,?,?)', name, icon || null, sort || 0);
    audit(req.user.id, 'menu.category_create', 'category', Number(info.lastInsertRowid), { name });
    changed('menu');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/categories/:id', need('menu.manage'), (req, res) => {
    const u = updateSql('categories', pick(req.body, ['name', 'icon', 'sort']), Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    audit(req.user.id, 'menu.category_update', 'category', Number(req.params.id), pick(req.body, ['name']));
    changed('menu');
    res.json({ ok: true });
  });
  r.delete('/categories/:id', need('menu.manage'), (req, res) => {
    const id = Number(req.params.id);
    const { c } = get('SELECT COUNT(*) AS c FROM menu_items WHERE category_id = ? AND active = 1', id);
    if (c) throw bad('الفئة تحتوي أصنافاً، انقلها أو احذفها أولاً');
    run('UPDATE categories SET active = 0 WHERE id = ?', id);
    audit(req.user.id, 'menu.category_delete', 'category', id);
    changed('menu');
    res.json({ ok: true });
  });

  r.get('/items/:id', need('menu.manage'), (req, res) => {
    const item = get('SELECT * FROM menu_items WHERE id = ?', Number(req.params.id));
    if (!item) throw notFound();
    item.modifiers = all('SELECT * FROM modifiers WHERE item_id = ?', item.id);
    item.recipe = all(`SELECT r.ingredient_id, r.qty, i.name, i.unit, i.cost_per_unit
      FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.item_id = ?`, item.id);
    item.cost = round2(item.recipe.reduce((a, x) => a + x.qty * x.cost_per_unit, 0));
    res.json(item);
  });

  const ITEM_FIELDS = ['category_id', 'name', 'description', 'price', 'image', 'station', 'available', 'sort'];
  function saveItemChildren(itemId, body) {
    if (Array.isArray(body.modifiers)) {
      run('DELETE FROM modifiers WHERE item_id = ?', itemId);
      for (const m of body.modifiers) if (m.name) run('INSERT INTO modifiers(item_id, name, price) VALUES(?,?,?)', itemId, m.name, Number(m.price) || 0);
    }
    if (Array.isArray(body.recipe)) {
      run('DELETE FROM recipes WHERE item_id = ?', itemId);
      for (const x of body.recipe) if (x.ingredient_id && Number(x.qty) > 0) {
        run('INSERT INTO recipes(item_id, ingredient_id, qty) VALUES(?,?,?)', itemId, x.ingredient_id, Number(x.qty));
      }
    }
  }
  r.post('/items', need('menu.manage'), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.category_id) throw bad('أدخل الاسم والفئة');
    const id = tx(() => {
      const info = run('INSERT INTO menu_items(category_id, name, description, price, image, station, available, sort) VALUES(?,?,?,?,?,?,?,?)',
        b.category_id, b.name, b.description || null, Number(b.price) || 0, b.image || null, b.station || 'kitchen', b.available === false ? 0 : 1, b.sort || 0);
      const newId = Number(info.lastInsertRowid);
      saveItemChildren(newId, b);
      return newId;
    });
    audit(req.user.id, 'item.create', 'item', id);
    changed('menu');
    res.status(201).json({ id });
  });
  r.put('/items/:id', need('menu.manage'), (req, res) => {
    const id = Number(req.params.id);
    const before = get('SELECT price FROM menu_items WHERE id = ?', id);
    if (!before) throw notFound();
    tx(() => {
      const u = updateSql('menu_items', pick(req.body, ITEM_FIELDS), id);
      if (u) run(u.sql, ...u.params);
      saveItemChildren(id, req.body || {});
    });
    if (req.body.price !== undefined && Number(req.body.price) !== before.price) {
      audit(req.user.id, 'item.price_change', 'item', id, { from: before.price, to: Number(req.body.price) });
    }
    changed('menu');
    res.json({ ok: true });
  });
  // تفعيل/إيقاف الصنف سريعاً (مسموح للمطبخ أيضاً عند نفاد صنف)
  r.patch('/items/:id/availability', need('menu.manage', 'menu.availability'), (req, res) => {
    run('UPDATE menu_items SET available = ? WHERE id = ?', req.body.available ? 1 : 0, Number(req.params.id));
    audit(req.user.id, req.body.available ? 'item.available' : 'item.unavailable', 'item', Number(req.params.id));
    changed('menu');
    res.json({ ok: true });
  });
  r.delete('/items/:id', need('menu.manage'), (req, res) => {
    run('UPDATE menu_items SET active = 0 WHERE id = ?', Number(req.params.id));
    audit(req.user.id, 'item.delete', 'item', Number(req.params.id));
    changed('menu');
    res.json({ ok: true });
  });

  // ───────────── الطاولات ─────────────
  r.get('/tables', need('tables.view', 'pos.create', 'payments.collect', 'settings.manage', 'reservations.manage'), (req, res) => {
    const tables = all(`
      SELECT t.id, t.name, t.seats, t.area, t.active, t.qr_open_until,
        CASE WHEN t.qr_open_until > datetime('now','localtime') THEN 1 ELSE 0 END AS qr_open,
        CASE WHEN t.qr_request_at > datetime('now','localtime','-15 minutes') AND COALESCE(t.qr_open_until, '') <= datetime('now','localtime') THEN 1 ELSE 0 END AS qr_requested, o.pending_confirm AS pending_confirm, CASE WHEN t.qr_open_until > datetime('now','localtime') THEN (SELECT name FROM users WHERE id = t.qr_opened_by) END AS qr_opened_by_name, t.qr_request_at, o.id AS order_id, o.number AS order_number, o.code AS order_code, o.total AS order_total, o.created_at AS opened_at,
        o.guests, w.name AS waiter_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'ready') AS ready_items,
        (SELECT r.customer_name || ' ' || substr(r.reserved_at, 12, 5) FROM reservations r
          WHERE r.table_id = t.id AND r.status = 'booked' AND date(r.reserved_at) = date('now','localtime')
          ORDER BY r.reserved_at LIMIT 1) AS reservation
      FROM dining_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
      LEFT JOIN users w ON w.id = o.waiter_id
      WHERE t.active = 1 ORDER BY t.area, t.id`);
    res.json(tables.map((t) => ({ ...t, status: t.order_id ? 'occupied' : t.reservation ? 'reserved' : 'free' })));
  });
  // رموز QR للطاولات (للإدارة فقط)
  r.get('/tables/qr', need('settings.manage'), (req, res) => {
    ensureTableTokens();
    res.json(all('SELECT id, name, seats, area, qr_token AS token FROM dining_tables WHERE active = 1 ORDER BY id'));
  });
  r.post('/tables/:id/qr/rotate', need('settings.manage'), (req, res) => {
    const t = get('SELECT id, name FROM dining_tables WHERE id = ?', Number(req.params.id));
    if (!t) throw notFound('الطاولة غير موجودة');
    const token = randomToken();
    run('UPDATE dining_tables SET qr_token = ? WHERE id = ?', token, t.id);
    audit(req.user.id, 'settings.table_qr_rotate', 'table', t.id, { name: t.name });
    res.json({ id: t.id, name: t.name, token });
  });
  // فتح الطاولة لطلب QR (النادل/الكاشير): تُغلق تلقائياً بعد المدة أو بالدفع/الإلغاء
  r.post('/tables/:id/qr/open', need('pos.create', 'payments.collect', 'tables.view'), (req, res) => {
    const t = get("SELECT id, name, qr_request_at, qr_open_until, qr_opened_by, CASE WHEN qr_request_at > datetime('now','localtime','-15 minutes') THEN 1 ELSE 0 END AS requested FROM dining_tables WHERE id = ? AND active = 1", Number(req.params.id));
    if (!t) throw notFound('الطاولة غير موجودة');
    const minutes = Math.round(Math.min(Math.max(Number(req.body?.hours) || 2, 0.25), 12) * 60);
    run(`UPDATE dining_tables SET qr_request_at = NULL, qr_open_until = datetime('now','localtime','+${minutes} minutes'), qr_opened_by = ?, qr_opened_at = datetime('now','localtime') WHERE id = ?`, req.user.id, t.id);
    audit(req.user.id, 'qr.table_open', 'table', t.id, { name: t.name, minutes, answered_request: !!t.requested });
    // نُعلم بقية الموظفين أن زميلهم استلم الطلب حتى لا يتكرر
    if (t.requested) notify({ perms: ['pos.create', 'payments.collect'], roles: ['admin', 'manager'], exclude: req.user.id, type: 'qr_request_taken', level: 'info', link: `/tables?table=${t.id}`, title: `${req.user.name} استلم طلب فتح ${t.name}`, body: 'تم فتح الطاولة للطلب بالـ QR.' });
    changed('tables');
    res.json({ id: t.id, open: true, by: req.user.name });
  });
  r.post('/tables/:id/qr/close', need('pos.create', 'payments.collect', 'tables.view'), (req, res) => {
    const t = get('SELECT id, name FROM dining_tables WHERE id = ?', Number(req.params.id));
    if (!t) throw notFound('الطاولة غير موجودة');
    run('UPDATE dining_tables SET qr_open_until = NULL, qr_opened_by = NULL WHERE id = ?', t.id);
    audit(req.user.id, 'qr.table_close', 'table', t.id, { name: t.name });
    changed('tables');
    res.json({ id: t.id, open: false });
  });
  r.get('/qr/log', need('settings.manage', 'activity.view'), (req, res) => {
    res.json(all(`SELECT l.id, l.at, l.ip, l.device_id, l.event, l.detail, t.name AS table_name
      FROM qr_log l LEFT JOIN dining_tables t ON t.id = l.table_id WHERE l.event != 'scan' ORDER BY l.id DESC LIMIT 150`));
  });

  r.post('/tables', need('settings.manage'), (req, res) => {
    const { name, seats, area } = req.body || {};
    if (!name) throw bad('أدخل اسم الطاولة');
    const info = run('INSERT INTO dining_tables(name, seats, area, qr_token) VALUES(?,?,?,?)', name, Number(seats) || 4, area || 'الصالة', randomToken());
    audit(req.user.id, 'settings.table_create', 'table', Number(info.lastInsertRowid), { name });
    changed('tables');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/tables/:id', need('settings.manage'), (req, res) => {
    const u = updateSql('dining_tables', pick(req.body, ['name', 'seats', 'area']), Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    changed('tables');
    res.json({ ok: true });
  });
  r.delete('/tables/:id', need('settings.manage'), (req, res) => {
    const id = Number(req.params.id);
    if (get("SELECT id FROM orders WHERE table_id = ? AND status = 'open'", id)) throw bad('الطاولة عليها طلب مفتوح');
    run('UPDATE dining_tables SET active = 0 WHERE id = ?', id);
    audit(req.user.id, 'settings.table_delete', 'table', id);
    changed('tables');
    res.json({ ok: true });
  });

  // ───────────── الطلبات ─────────────
  r.get('/orders', need('orders.view', 'pos.create', 'payments.collect'), (req, res) => {
    const { status, type, date, from, to } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (type) { where.push('o.type = ?'); params.push(type); }
    if (date) { where.push('date(o.created_at) = ?'); params.push(date); }
    if (from) { where.push('date(o.created_at) >= ?'); params.push(from); }
    if (to) { where.push('date(o.created_at) <= ?'); params.push(to); }
    if (!hasPerm(req.user, 'orders.view') && !hasPerm(req.user, 'payments.collect') && !status) { where.push("o.status = 'open'"); }
    const rows = all(`
      SELECT o.*, t.name AS table_name, ev.name AS event_name, w.name AS waiter_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'cancelled') AS items_count,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'ready') AS ready_items,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'pending') AS pending_items
      FROM orders o
      LEFT JOIN dining_tables t ON t.id = o.table_id
      LEFT JOIN events ev ON ev.id = o.event_id
      LEFT JOIN users w ON w.id = o.waiter_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.id DESC LIMIT 300`, ...params);
    res.json(rows);
  });

  // سجل التحصيلات: الكاشير يرى تحصيلاته فقط، ومن يملك payments.view_all يرى الجميع
  r.get('/payments/history', need('payments.collect', 'payments.view_all'), (req, res) => {
    const all_ = hasPerm(req.user, 'payments.view_all');
    const { from, to, method, q } = req.query;
    const uid = all_ ? (Number(req.query.user_id) || null) : req.user.id;
    const where = ["o.status != 'cancelled'"];
    const params = [];
    if (from) { where.push('date(p.created_at) >= ?'); params.push(from); }
    if (to) { where.push('date(p.created_at) <= ?'); params.push(to); }
    if (method && ['cash', 'card', 'wallet'].includes(method)) { where.push('p.method = ?'); params.push(method); }
    if (uid) { where.push('p.user_id = ?'); params.push(uid); }
    if (q) {
      where.push('(o.code LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR t.name LIKE ?)');
      params.push(...Array(4).fill(`%${String(q).trim()}%`));
    }
    const W = 'WHERE ' + where.join(' AND ');
    const base = 'FROM payments p JOIN orders o ON o.id = p.order_id LEFT JOIN dining_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = p.user_id';
    const rows = all(`
      SELECT o.id AS order_id, o.code, o.type, o.total, o.discount, o.customer_name, o.customer_phone, t.name AS table_name,
        p.user_id, u.name AS user_name, MIN(p.created_at) AS paid_at, ROUND(SUM(p.amount), 2) AS amount,
        GROUP_CONCAT(DISTINCT p.method) AS methods, p.shift_id
      ${base} ${W} GROUP BY p.order_id, p.user_id ORDER BY MIN(p.id) DESC LIMIT 500`, ...params);
    const byMethod = all(`SELECT p.method, ROUND(SUM(p.amount), 2) AS total, COUNT(*) AS n ${base} ${W} GROUP BY p.method`, ...params);
    const byCashier = all_ ? all(`SELECT p.user_id, u.name AS user_name, ROUND(SUM(p.amount), 2) AS total, COUNT(DISTINCT p.order_id) AS n ${base} ${W} GROUP BY p.user_id ORDER BY total DESC`, ...params) : [];
    res.json({
      all: all_,
      rows,
      summary: { count: rows.length, total: round2(rows.reduce((a, r) => a + r.amount, 0)), byMethod, byCashier },
      cashiers: all_ ? all("SELECT DISTINCT u.id, u.name FROM payments p JOIN users u ON u.id = p.user_id ORDER BY u.name") : [],
    });
  });

  r.get('/orders/:id', need('orders.view', 'pos.create', 'payments.collect', 'kitchen.view'), (req, res) => res.json(Orders.getOrder(Number(req.params.id))));

  const orderChanged = (id) => {
    changed('orders', 'tables');
    emit('public-order', id);
    return Orders.getOrder(id);
  };

  r.post('/orders', need('pos.create'), (req, res) => {
    const id = Orders.createOrder(req.body || {}, req.user);
    if (req.body?.send) { Orders.sendToKitchen(id, req.user); changed('kitchen'); }
    res.status(201).json(orderChanged(id));
  });
  r.post('/orders/:id/items', need('pos.create'), (req, res) => {
    const id = Number(req.params.id);
    Orders.addItems(id, req.body?.items, req.user);
    if (req.body?.send) { Orders.sendToKitchen(id, req.user); changed('kitchen'); }
    res.json(orderChanged(id));
  });
  r.patch('/orders/:id/items/:lineId', need('pos.create', 'orders.cancel_item'), (req, res) => {
    const id = Number(req.params.id);
    Orders.updateItem(id, Number(req.params.lineId), req.body || {}, req.user);
    changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/send', need('pos.create'), (req, res) => {
    const id = Number(req.params.id);
    const count = Orders.sendToKitchen(id, req.user);
    if (count) changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/serve', need('pos.create', 'payments.collect'), (req, res) => {
    const id = Number(req.params.id);
    const ch = run("UPDATE order_items SET status = 'served' WHERE order_id = ? AND status = 'ready'", id);
    Orders.kitchenProgress(id, 'served', req.user, Number(ch.changes));
    changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/request-bill', need('pos.create'), (req, res) => {
    const id = Number(req.params.id);
    Orders.requestBill(id, req.user);
    audit(req.user.id, 'order.request_bill', 'order', id);
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/discount', need('orders.discount'), (req, res) => {
    const id = Number(req.params.id);
    Orders.setDiscount(id, req.body || {}, req.user);
    res.json(orderChanged(id));
  });
  r.put('/orders/:id', need('pos.create', 'payments.collect'), (req, res) => {
    const id = Number(req.params.id);
    const o = get('SELECT status FROM orders WHERE id = ?', id);
    if (!o) throw notFound();
    if (o.status !== 'open') throw bad('الطلب مغلق');
    const u = updateSql('orders', pick(req.body, ['customer_name', 'customer_phone', 'address', 'guests', 'notes']), id);
    if (u) run(u.sql, ...u.params);
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/pay', need('payments.collect'), (req, res) => {
    const id = Number(req.params.id);
    const result = Orders.pay(id, req.body?.payments, req.user);
    if (result.closed) changed('inventory', 'kitchen');
    res.json({ ...result, order: orderChanged(id) });
  });
  r.post('/orders/:id/confirm', need('pos.create', 'payments.collect'), (req, res) => {
    const id = Number(req.params.id);
    Orders.confirmOrder(id, req.user);
    changed('kitchen', 'orders', 'tables');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/reject', need('pos.create', 'payments.collect'), (req, res) => {
    const id = Number(req.params.id);
    Orders.rejectOrder(id, clip(req.body?.reason, 100), req.user);
    changed('kitchen', 'orders', 'tables');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/cancel', need('orders.cancel'), (req, res) => {
    const id = Number(req.params.id);
    Orders.cancelOrder(id, req.body?.reason, req.user);
    changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/move', need('orders.move'), (req, res) => {
    const id = Number(req.params.id);
    Orders.moveTable(id, Number(req.body?.table_id), req.user);
    res.json(orderChanged(id));
  });

  // ───────────── شاشة المطبخ ─────────────
  r.get('/kitchen', need('kitchen.view', 'kitchen.update'), (req, res) => {
    const { station } = req.query;
    const items = all(`
      SELECT oi.*, o.number, o.code, o.source, o.type, o.guests, o.customer_name, o.notes AS order_notes, o.place, ev.name AS event_name, t.name AS table_name,
        w.name AS waiter_name, sb.name AS sent_by_name, sb.role AS sent_by_role
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN events ev ON ev.id = o.event_id
      LEFT JOIN dining_tables t ON t.id = o.table_id
      LEFT JOIN users w ON w.id = o.waiter_id
      LEFT JOIN users sb ON sb.id = oi.sent_by
      WHERE oi.status IN ('new','preparing','ready') AND o.status != 'cancelled'
      ${station ? 'AND oi.station = ?' : ''}
      ORDER BY oi.sent_at, oi.id`, ...(station ? [station] : []));
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.order_id)) {
        map.set(it.order_id, {
          order_id: it.order_id, number: it.number, code: it.code, source: it.source, type: it.type, table_name: it.table_name, event_name: it.event_name, place: it.place,
          guests: it.guests, customer_name: it.customer_name,
          waiter_name: it.waiter_name, sent_by_name: it.sent_by_name || it.waiter_name, sent_by_role: it.sent_by_role,
          notes: it.order_notes, sent_at: it.sent_at, items: [],
        });
      }
      map.get(it.order_id).items.push({
        id: it.id, name: it.name, qty: it.qty, notes: it.notes, status: it.status, station: it.station,
        modifiers: it.modifiers ? JSON.parse(it.modifiers) : [], sent_at: it.sent_at, sent_by_name: it.sent_by_name,
      });
    }
    const orders = [...map.values()];
    // حالة التذكرة = أقل حالة بين أصنافها
    for (const o of orders) {
      o.stage = o.items.some((i) => i.status === 'new') ? 'new' : o.items.some((i) => i.status === 'preparing') ? 'preparing' : 'ready';
    }
    res.json(orders);
  });
  r.patch('/kitchen/items/:id', need('kitchen.update'), (req, res) => {
    const { status } = req.body || {};
    if (!['new', 'preparing', 'ready', 'served'].includes(status)) throw bad('الحالة غير صحيحة');
    const item = get('SELECT order_id, status FROM order_items WHERE id = ?', Number(req.params.id));
    if (!item) throw notFound();
    run(`UPDATE order_items SET status = ?, ready_at = CASE WHEN ? = 'ready' THEN datetime('now','localtime') ELSE ready_at END WHERE id = ?`,
      status, status, Number(req.params.id));
    if (status !== 'new') Orders.kitchenProgress(item.order_id, status, req.user, item.status !== status);
    changed('kitchen', 'orders', 'tables');
    emit('public-order', item.order_id);
    res.json({ ok: true });
  });
  r.post('/kitchen/orders/:id/bump', need('kitchen.update'), (req, res) => {
    const { status = 'ready' } = req.body || {};
    if (!['preparing', 'ready', 'served'].includes(status)) throw bad('الحالة غير صحيحة');
    const from = { preparing: "('new')", ready: "('new','preparing')", served: "('ready')" }[status];
    const id = Number(req.params.id);
    const ch = run(`UPDATE order_items SET status = ?, ready_at = CASE WHEN ? = 'ready' THEN datetime('now','localtime') ELSE ready_at END
      WHERE order_id = ? AND status IN ${from}`, status, status, id);
    Orders.kitchenProgress(id, status, req.user, Number(ch.changes));
    changed('kitchen', 'orders', 'tables');
    emit('public-order', id);
    res.json({ ok: true });
  });

  // ───────────── المخزون ─────────────
  r.get('/ingredients', need('inventory.view', 'inventory.manage', 'menu.manage'), (req, res) => {
    res.json(all('SELECT *, (stock <= min_stock) AS low FROM ingredients WHERE active = 1 ORDER BY name'));
  });
  r.post('/ingredients', need('inventory.manage'), (req, res) => {
    const b = req.body || {};
    if (!b.name) throw bad('أدخل اسم المادة');
    const info = run('INSERT INTO ingredients(name, unit, stock, min_stock, cost_per_unit) VALUES(?,?,?,?,?)',
      b.name, b.unit || 'كغ', Number(b.stock) || 0, Number(b.min_stock) || 0, Number(b.cost_per_unit) || 0);
    audit(req.user.id, 'stock.ingredient_create', 'ingredient', Number(info.lastInsertRowid), { name: b.name });
    changed('inventory');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/ingredients/:id', need('inventory.manage'), (req, res) => {
    const u = updateSql('ingredients', pick(req.body, ['name', 'unit', 'min_stock', 'cost_per_unit']), Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    changed('inventory');
    res.json({ ok: true });
  });
  r.delete('/ingredients/:id', need('inventory.manage'), (req, res) => {
    run('UPDATE ingredients SET active = 0 WHERE id = ?', Number(req.params.id));
    changed('inventory');
    res.json({ ok: true });
  });
  // حركة مخزون: شراء / تالف / تسوية جرد
  r.post('/stock-movements', need('inventory.receive', 'inventory.manage'), (req, res) => {
    const { ingredient_id, qty, type, unit_cost, note } = req.body || {};
    const ing = get('SELECT * FROM ingredients WHERE id = ?', ingredient_id);
    if (!ing) throw notFound('المادة غير موجودة');
    if (!['purchase', 'waste', 'adjust'].includes(type)) throw bad('نوع الحركة غير صحيح');
    let delta = Number(qty);
    if (!Number.isFinite(delta)) throw bad('الكمية غير صحيحة');
    if (type === 'purchase' && delta <= 0) throw bad('كمية الشراء يجب أن تكون موجبة');
    if (type === 'waste') delta = -Math.abs(delta);
    if (type === 'adjust') delta = delta - ing.stock; // qty = الكمية الفعلية بعد الجرد
    tx(() => {
      run('UPDATE ingredients SET stock = stock + ? WHERE id = ?', delta, ing.id);
      if (type === 'purchase' && Number(unit_cost) > 0) {
        // متوسط التكلفة المرجّح
        const newStock = ing.stock + delta;
        const avg = newStock > 0 ? (Math.max(ing.stock, 0) * ing.cost_per_unit + delta * Number(unit_cost)) / (Math.max(ing.stock, 0) + delta) : Number(unit_cost);
        run('UPDATE ingredients SET cost_per_unit = ? WHERE id = ?', round2(avg * 1000) / 1000, ing.id);
      }
      run('INSERT INTO stock_movements(ingredient_id, qty, type, unit_cost, note, user_id) VALUES(?,?,?,?,?,?)',
        ing.id, delta, type, unit_cost ? Number(unit_cost) : null, note || null, req.user.id);
    });
    audit(req.user.id, `stock.${type}`, 'ingredient', ing.id, { name: ing.name, qty: Math.round(delta * 1000) / 1000, unit: ing.unit, note: note || undefined });
    changed('inventory');
    res.status(201).json({ ok: true });
  });
  r.get('/stock-movements', need('inventory.manage'), (req, res) => {
    const { ingredient_id } = req.query;
    res.json(all(`SELECT m.*, i.name AS ingredient_name, i.unit, u.name AS user_name
      FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id LEFT JOIN users u ON u.id = m.user_id
      ${ingredient_id ? 'WHERE m.ingredient_id = ?' : ''} ORDER BY m.id DESC LIMIT 300`, ...(ingredient_id ? [Number(ingredient_id)] : [])));
  });

  // ───────────── الورديات ─────────────
  function shiftSummary(shift) {
    const pays = all('SELECT method, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE shift_id = ? GROUP BY method', shift.id);
    const cash = pays.find((p) => p.method === 'cash')?.total || 0;
    const orders = get("SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS s FROM orders WHERE shift_id = ? AND status = 'paid'", shift.id);
    const drawer = get('SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM expenses WHERE shift_id = ? AND from_drawer = 1', shift.id);
    return { ...shift, payments: pays, orders_count: orders.c, sales: round2(orders.s), expenses_cash: round2(drawer.s), expenses_count: drawer.c, expected_cash: round2(shift.opening_cash + cash - drawer.s) };
  }
  r.get('/shifts/current', (req, res) => {
    const s = get('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE closed_at IS NULL ORDER BY s.id DESC LIMIT 1');
    res.json(s ? shiftSummary(s) : null);
  });
  r.get('/shifts', need('reports.view'), (req, res) => {
    res.json(all('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100'));
  });
  r.post('/shifts/open', need('shifts.manage'), (req, res) => {
    if (get('SELECT id FROM shifts WHERE closed_at IS NULL')) throw bad('توجد وردية مفتوحة بالفعل');
    const info = run('INSERT INTO shifts(user_id, opening_cash) VALUES(?,?)', req.user.id, Number(req.body?.opening_cash) || 0);
    audit(req.user.id, 'shift.open', 'shift', Number(info.lastInsertRowid));
    changed('shift');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.post('/shifts/close', need('shifts.manage'), (req, res) => {
    const s = get('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
    if (!s) throw bad('لا توجد وردية مفتوحة');
    const summary = shiftSummary(s);
    const closing = Number(req.body?.closing_cash) || 0;
    run("UPDATE shifts SET closing_cash = ?, expected_cash = ?, notes = ?, closed_at = datetime('now','localtime') WHERE id = ?",
      closing, summary.expected_cash, req.body?.notes || null, s.id);
    audit(req.user.id, 'shift.close', 'shift', s.id, { closing, expected: summary.expected_cash });
    changed('shift');
    res.json({ ...summary, closing_cash: closing, difference: round2(closing - summary.expected_cash) });
  });

  // ───────────── الحجوزات ─────────────
  r.get('/reservations', (req, res) => {
    const date = req.query.date || today();
    res.json(all(`SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN dining_tables t ON t.id = r.table_id
      WHERE date(r.reserved_at) = ? ORDER BY r.reserved_at`, date));
  });
  r.post('/reservations', need('reservations.manage'), (req, res) => {
    const b = req.body || {};
    if (!b.customer_name || !b.reserved_at) throw bad('أدخل اسم العميل ووقت الحجز');
    const info = run('INSERT INTO reservations(table_id, customer_name, phone, party_size, reserved_at, notes) VALUES(?,?,?,?,?,?)',
      b.table_id || null, b.customer_name, b.phone || null, Number(b.party_size) || 2, String(b.reserved_at).replace('T', ' '), b.notes || null);
    audit(req.user.id, 'reservation.create', 'reservation', Number(info.lastInsertRowid), { name: b.customer_name, at: b.reserved_at });
    changed('tables', 'reservations');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/reservations/:id', need('reservations.manage'), (req, res) => {
    const fields = pick(req.body, ['table_id', 'customer_name', 'phone', 'party_size', 'reserved_at', 'status', 'notes']);
    if (fields.reserved_at) fields.reserved_at = String(fields.reserved_at).replace('T', ' ');
    if (fields.status && !['booked', 'seated', 'cancelled', 'no_show'].includes(fields.status)) throw bad('الحالة غير صحيحة');
    const u = updateSql('reservations', fields, Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    audit(req.user.id, fields.status ? `reservation.${fields.status}` : 'reservation.update', 'reservation', Number(req.params.id));
    changed('tables', 'reservations');
    res.json({ ok: true });
  });

  // ───────────── العملاء ─────────────
  r.get('/customers', need('customers.view'), (req, res) => {
    const q = req.query.q ? `%${req.query.q}%` : null;
    res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS orders_count,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS total_spent
      FROM customers c ${q ? 'WHERE c.phone LIKE ? OR c.name LIKE ?' : ''} ORDER BY c.id DESC LIMIT 100`, ...(q ? [q, q] : [])));
  });

  // ───────────── التقارير ─────────────
  r.get('/reports/summary', need('reports.view'), (req, res) => {
    const from = req.query.from || today();
    const to = req.query.to || from;
    const range = "date(o.created_at) BETWEEN ? AND ?";
    const paid = `o.status = 'paid' AND ${range}`;
    const totals = get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(tax),0) AS tax,
      COALESCE(SUM(discount),0) AS discounts, COALESCE(SUM(service),0) AS service, COALESCE(AVG(total),0) AS avg_ticket
      FROM orders o WHERE ${paid}`, from, to);
    const cancelled = get(`SELECT COUNT(*) AS c FROM orders o WHERE o.status = 'cancelled' AND ${range}`, from, to).c;
    const byPayment = all(`SELECT p.method, SUM(p.amount) AS total FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE ${paid} GROUP BY p.method`, from, to);
    const byType = all(`SELECT type, COUNT(*) AS orders, SUM(total) AS total FROM orders o WHERE ${paid} GROUP BY type`, from, to);
    const topItems = all(`SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price) AS total
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${paid} AND oi.status != 'cancelled' GROUP BY oi.item_id ORDER BY qty DESC LIMIT 10`, from, to);
    const byCategory = all(`SELECT c.name, SUM(oi.qty * oi.price) AS total, SUM(oi.qty) AS qty
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN menu_items m ON m.id = oi.item_id JOIN categories c ON c.id = m.category_id
      WHERE ${paid} AND oi.status != 'cancelled' GROUP BY c.id ORDER BY total DESC`, from, to);
    const byHour = all(`SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS total
      FROM orders o WHERE ${paid} GROUP BY hour ORDER BY hour`, from, to);
    const byDay = all(`SELECT date(o.created_at) AS day, COUNT(*) AS orders, SUM(total) AS total
      FROM orders o WHERE ${paid} GROUP BY day ORDER BY day`, from, to);
    const byStaff = all(`SELECT u.name, COUNT(*) AS orders, SUM(o.total) AS total
      FROM orders o JOIN users u ON u.id = o.waiter_id WHERE ${paid} GROUP BY u.id ORDER BY total DESC`, from, to);
    const cogs = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m
      JOIN ingredients i ON i.id = m.ingredient_id JOIN orders o ON o.id = m.order_id
      WHERE m.type = 'sale' AND ${paid}`, from, to).v;
    const waste = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m
      JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'waste' AND date(m.created_at) BETWEEN ? AND ?`, from, to).v;
    const lowStock = all('SELECT id, name, unit, stock, min_stock FROM ingredients WHERE active = 1 AND stock <= min_stock ORDER BY name');
    const netSales = totals.sales - totals.tax;
    res.json({
      from, to,
      totals: { ...mapRound(totals), cancelled, cogs: round2(cogs), waste: round2(waste), net_sales: round2(netSales), gross_profit: round2(netSales - cogs) },
      byPayment: byPayment.map(mapRound), byType: byType.map(mapRound), topItems: topItems.map(mapRound),
      byCategory: byCategory.map(mapRound), byHour: byHour.map(mapRound), byDay: byDay.map(mapRound), byStaff: byStaff.map(mapRound),
      lowStock,
    });
  });

  // ───────────── الموارد البشرية ─────────────
  hrRoutes(r, changed);
  attendanceRoutes(r, changed);

  // ───────────── الإشعارات ─────────────
  r.get('/notifications', (req, res) => {
    const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
    const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).c;
    res.json({ rows, unread });
  });
  r.post('/notifications/read', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
    if (ids?.length) {
      run(`UPDATE notifications SET read_at = datetime('now','localtime') WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, req.user.id, ...ids);
    } else {
      run("UPDATE notifications SET read_at = datetime('now','localtime') WHERE user_id = ? AND read_at IS NULL", req.user.id);
    }
    res.json({ ok: true });
  });
  r.delete('/notifications', (req, res) => {
    run('DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL', req.user.id);
    res.json({ ok: true });
  });

  // ───────────── الإشعارات الفورية (أجهزة الأندرويد) ─────────────
  r.get('/push/status', (req, res) => {
    const devices = get('SELECT COUNT(*) AS c FROM device_tokens WHERE user_id = ?', req.user.id).c;
    res.json({ enabled: pushEnabled(), devices });
  });
  r.post('/push/register', (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (token.length < 20 || token.length > 4096) throw bad('رمز الجهاز غير صحيح');
    const platform = ['android', 'ios', 'web'].includes(req.body?.platform) ? req.body.platform : 'android';
    run(`INSERT INTO device_tokens(user_id, token, platform) VALUES(?,?,?)
      ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = datetime('now','localtime')`,
    req.user.id, token, platform);
    res.json({ ok: true, enabled: pushEnabled() });
  });
  r.post('/push/unregister', (req, res) => {
    run('DELETE FROM device_tokens WHERE token = ? AND user_id = ?', String(req.body?.token || ''), req.user.id);
    res.json({ ok: true });
  });
  r.post('/push/test', (req, res) => {
    notify({ userIds: [req.user.id], type: 'test', level: 'success', link: '/settings', title: 'إشعار تجريبي', body: 'الإشعارات تعمل على هذا الجهاز ✓' });
    res.json({ ok: true, enabled: pushEnabled() });
  });

  // ───────────── المركز المباشر للإدارة: لقطة كاملة لحظية (طاولات + مراحل الطلبات + مؤشرات) ─────────────
  r.get('/live', need('reports.view'), (req, res) => {
    const tables = all(`SELECT t.id, t.name, t.seats, t.area,
        CASE WHEN t.qr_open_until > datetime('now','localtime') THEN 1 ELSE 0 END AS qr_open,
        CASE WHEN t.qr_request_at > datetime('now','localtime','-15 minutes') AND COALESCE(t.qr_open_until, '') <= datetime('now','localtime') THEN 1 ELSE 0 END AS qr_requested,
        CASE WHEN t.qr_open_until > datetime('now','localtime') THEN (SELECT name FROM users WHERE id = t.qr_opened_by) END AS qr_opened_by_name,
        (SELECT r.customer_name || ' ' || substr(r.reserved_at, 12, 5) FROM reservations r
          WHERE r.table_id = t.id AND r.status = 'booked' AND date(r.reserved_at) = date('now','localtime') ORDER BY r.reserved_at LIMIT 1) AS reservation
      FROM dining_tables t WHERE t.active = 1 ORDER BY t.id`);
    const open = all(`SELECT o.id, o.code, o.type, o.table_id, o.source, o.place, (SELECT name FROM events WHERE id = o.event_id) AS event_name, o.total, o.guests, o.created_at, o.customer_name, o.bill_requested_at, o.bill_method,
        o.pending_confirm, w.name AS waiter_name FROM orders o LEFT JOIN users w ON w.id = o.waiter_id WHERE o.status = 'open' ORDER BY o.id`);
    const lines = all(`SELECT oi.order_id, oi.name, oi.qty, oi.status, oi.sent_at, oi.ready_at FROM order_items oi
      JOIN orders o ON o.id = oi.order_id WHERE o.status = 'open' AND oi.status != 'cancelled'`);
    const nowMs = Date.now();
    const ts = (s) => (s ? new Date(String(s).replace(' ', 'T')).getTime() : null);
    const byOrder = new Map(open.map((o) => [o.id, { ...o, items: { draft: 0, new: 0, preparing: 0, ready: 0, served: 0 }, lines: [], oldest_sent_at: null }]));
    for (const l of lines) {
      const o = byOrder.get(l.order_id); if (!o) continue;
      const k = l.status === 'pending' ? 'draft' : l.status;
      o.items[k] = (o.items[k] || 0) + 1;
      o.lines.push({ name: l.name, qty: l.qty, status: l.status });
      if ((l.status === 'new' || l.status === 'preparing') && l.sent_at && (!o.oldest_sent_at || l.sent_at < o.oldest_sent_at)) o.oldest_sent_at = l.sent_at;
    }
    // مرحلة واحدة لكل طلب
    const LATE_MIN = 15;
    const stageOf = (o) => {
      const i = o.items; const total = i.draft + i.new + i.preparing + i.ready + i.served;
      if (o.pending_confirm) return 'confirm';
      if (o.bill_requested_at) return 'bill';
      if (!total) return 'draft';
      if (i.new) return 'new';
      if (i.preparing) return 'preparing';
      if (i.draft && !i.ready && !i.served) return 'draft';
      if (i.ready) return 'ready';
      return 'served';
    };
    const orders = [...byOrder.values()].map((o) => {
      const stage = stageOf(o);
      const since = ts(o.oldest_sent_at);
      const late = since && (nowMs - since) / 60000 > LATE_MIN && (stage === 'new' || stage === 'preparing');
      return { ...o, stage, late: !!late, age_min: Math.max(0, Math.round((nowMs - ts(o.created_at)) / 60000)) };
    });
    const ordersByTable = new Map(orders.filter((o) => o.table_id).map((o) => [o.table_id, o]));
    const floor = tables.map((t) => {
      const o = ordersByTable.get(t.id) || null;
      return { ...t, status: o ? 'occupied' : t.reservation ? 'reserved' : 'free', order_id: o?.id || null };
    });
    const stages = { confirm: 0, draft: 0, new: 0, preparing: 0, ready: 0, served: 0, bill: 0 };
    orders.forEach((o) => { stages[o.stage]++; });
    const today = "date('now','localtime')";
    const paid = get(`SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS s FROM orders WHERE status = 'paid' AND date(closed_at) = ${today}`);
    const cancelled = get(`SELECT COUNT(*) AS c FROM orders WHERE status = 'cancelled' AND date(closed_at) = ${today}`).c;
    const prep = get(`SELECT AVG((julianday(ready_at) - julianday(sent_at)) * 1440) AS m FROM order_items WHERE ready_at IS NOT NULL AND sent_at IS NOT NULL AND date(sent_at) = ${today}`).m;
    const hourly = Array.from({ length: 24 }, (_, h) => ({ h, sales: 0, orders: 0 }));
    for (const x of all(`SELECT CAST(strftime('%H', closed_at) AS INTEGER) AS h, SUM(total) AS s, COUNT(*) AS c FROM orders WHERE status = 'paid' AND date(closed_at) = ${today} GROUP BY h`)) {
      hourly[x.h].sales = round2(x.s); hourly[x.h].orders = x.c;
    }
    const byType = all(`SELECT type, COUNT(*) AS c FROM orders WHERE status != 'cancelled' AND date(created_at) = ${today} GROUP BY type`);
    const bySource = all(`SELECT source, COUNT(*) AS c FROM orders WHERE status != 'cancelled' AND date(created_at) = ${today} GROUP BY source`);
    res.json({
      now: new Date().toISOString(), late_minutes: LATE_MIN,
      floor, orders, stages,
      kpis: {
        sales_today: round2(paid.s), paid_today: paid.c, cancelled_today: cancelled,
        open_orders: orders.length, guests_now: orders.reduce((a, o) => a + (o.guests || 0), 0),
        occupied: floor.filter((t) => t.status === 'occupied').length, tables: floor.length,
        avg_prep_min: prep == null ? null : round2(prep), avg_ticket: paid.c ? round2(paid.s / paid.c) : 0,
        late: orders.filter((o) => o.late).length, bills: stages.bill, confirms: stages.confirm,
        qr_requests: floor.filter((t) => t.qr_requested).length,
      },
      hourly, by_type: byType, by_source: bySource,
    });
  });

  r.get('/chat/threads', need('chat.reply'), (req, res) => {
    res.json(all(`SELECT g.event_id, g.device_id, e.name AS event_name, g.unread, l.body AS last_body, l.sender AS last_sender, l.created_at AS last_at,
        (SELECT name FROM chat_messages WHERE event_id = g.event_id AND device_id = g.device_id AND sender = 'customer' AND name IS NOT NULL ORDER BY id DESC LIMIT 1) AS customer_name
      FROM (SELECT event_id, device_id, MAX(id) AS last_id, SUM(CASE WHEN sender = 'customer' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM chat_messages GROUP BY event_id, device_id) g
      JOIN chat_messages l ON l.id = g.last_id JOIN events e ON e.id = g.event_id ORDER BY g.last_id DESC LIMIT 200`));
  });
  r.get('/chat/thread', need('chat.reply'), (req, res) => {
    const eid = Number(req.query.event_id); const dev = devOf(req.query.device_id);
    run("UPDATE chat_messages SET read_at = datetime('now','localtime') WHERE event_id = ? AND device_id = ? AND sender = 'customer' AND read_at IS NULL", eid, dev);
    res.json({ event: get('SELECT id, name, contact_name, contact_phone FROM events WHERE id = ?', eid), messages: all('SELECT m.id, m.sender, m.name, m.body, m.created_at, u.name AS staff_name FROM chat_messages m LEFT JOIN users u ON u.id = m.staff_id WHERE m.event_id = ? AND m.device_id = ? ORDER BY m.id', eid, dev) });
  });
  r.post('/chat/reply', need('chat.reply'), (req, res) => {
    const eid = Number(req.body?.event_id); const dev = devOf(req.body?.device_id);
    const ev = get('SELECT id, name FROM events WHERE id = ?', eid);
    if (!ev) throw notFound('الفعالية غير موجودة');
    const body = clip(req.body?.body, 500);
    if (!body) throw bad('اكتب الرد');
    run("UPDATE chat_messages SET read_at = datetime('now','localtime') WHERE event_id = ? AND device_id = ? AND sender = 'customer' AND read_at IS NULL", eid, dev);
    const id = Number(run('INSERT INTO chat_messages(event_id, device_id, sender, staff_id, name, body) VALUES(?,?,?,?,?,?)', eid, dev, 'staff', req.user.id, req.user.name, body).lastInsertRowid);
    emit('chat', { event_id: eid });
    emit('public-chat', `${eid}:${dev}`);
    const o = get('SELECT id FROM orders WHERE event_id = ? AND device_id = ? ORDER BY id DESC LIMIT 1', eid, dev);
    if (o) customerNotify(o.id, { kind: 'chat', title: `رد من ${ev.name}`, body: body.slice(0, 140) });
    res.status(201).json({ id });
  });

  // ───────────── فعاليات المؤسسات (إدارة) ─────────────
  const evRow = (e) => ({ ...e, places: e.places ? JSON.parse(e.places) : [], state: eventState(e) });
  const toDb = (s) => { const v = String(s || '').trim().replace('T', ' '); return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? (v.length === 16 ? `${v}:00` : v) : null; };
  const readEvent = (b) => {
    const name = clip(b.name, 80);
    if (!name) throw bad('أدخل اسم المؤسسة أو الفعالية');
    const starts = toDb(b.starts_at); const ends = toDb(b.ends_at);
    if (!starts || !ends) throw bad('حدّد وقت البداية والنهاية');
    if (ends <= starts) throw bad('وقت النهاية يجب أن يكون بعد البداية');
    const menu_mode = ['full', 'selected', 'cap'].includes(b.menu_mode) ? b.menu_mode : 'selected';
    const price_cap = Number(b.price_cap) > 0 ? Number(b.price_cap) : null;
    if (menu_mode === 'cap' && !price_cap) throw bad('حدّد أقصى سعر للصنف');
    const item_ids = [...new Set((Array.isArray(b.item_ids) ? b.item_ids : []).map(Number).filter(Boolean))];
    if (menu_mode === 'selected' && !item_ids.length) throw bad('اختر أصنافاً للقائمة المحددة');
    const order_cap = Number(b.order_cap) > 0 ? Number(b.order_cap) : null;
    const places = (Array.isArray(b.places) ? b.places : String(b.places || '').split('\n')).map((p) => clip(p, 40)).filter(Boolean).slice(0, 80);
    return {
      name, contact_name: clip(b.contact_name, 60) || null, contact_phone: clip(b.contact_phone, 20) || null, starts, ends, menu_mode, price_cap, order_cap, item_ids,
      billing: b.billing === 'individual' ? 'individual' : 'institution', needs_approval: b.needs_approval ? 1 : 0, places: places.length ? JSON.stringify(places) : null, notes: clip(b.notes, 300) || null,
      welcome_message: clip(b.welcome_message, 400) || null, support_phone: clip(b.support_phone, 20) || null, support_chat: b.support_chat === false || b.support_chat === 0 ? 0 : 1,
      active: b.active === false || b.active === 0 ? 0 : 1,
    };
  };
  const saveItems = (id, ids) => { run('DELETE FROM event_items WHERE event_id = ?', id); for (const i of ids) run('INSERT OR IGNORE INTO event_items(event_id, item_id) SELECT ?, id FROM menu_items WHERE id = ?', id, i); };
  const evStats = (id) => get(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total END), 0) AS total, COALESCE(SUM(CASE WHEN status = 'paid' THEN total END), 0) AS paid,
      COALESCE(SUM(CASE WHEN status = 'open' THEN 1 END), 0) AS open_orders FROM orders WHERE event_id = ?`, id);

  r.get('/events', need('events.manage'), (req, res) => {
    res.json(all('SELECT * FROM events ORDER BY starts_at DESC, id DESC').map((e) => ({ ...evRow(e), item_count: get('SELECT COUNT(*) AS c FROM event_items WHERE event_id = ?', e.id).c, ...evStats(e.id) })));
  });
  r.get('/events/:id', need('events.manage'), (req, res) => {
    const e = get('SELECT * FROM events WHERE id = ?', Number(req.params.id));
    if (!e) throw notFound('الفعالية غير موجودة');
    res.json({
      ...evRow(e), ...evStats(e.id), item_ids: all('SELECT item_id FROM event_items WHERE event_id = ?', e.id).map((x) => x.item_id),
      orders: all(`SELECT o.id, o.code, o.customer_name, o.customer_phone, o.place, o.status, o.total, o.paid, o.created_at, o.pending_confirm,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'cancelled') AS items_count
        FROM orders o WHERE o.event_id = ? ORDER BY o.id DESC LIMIT 500`, e.id),
    });
  });
  r.post('/events', need('events.manage'), (req, res) => {
    const d = readEvent(req.body || {});
    const info = run('INSERT INTO events(name, contact_name, contact_phone, starts_at, ends_at, menu_mode, price_cap, order_cap, billing, needs_approval, places, notes, token, active, created_by, welcome_message, support_phone, support_chat) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      d.name, d.contact_name, d.contact_phone, d.starts, d.ends, d.menu_mode, d.price_cap, d.order_cap, d.billing, d.needs_approval, d.places, d.notes, randomToken(), d.active, req.user.id, d.welcome_message, d.support_phone, d.support_chat);
    const id = Number(info.lastInsertRowid);
    saveItems(id, d.menu_mode === 'selected' ? d.item_ids : []);
    audit(req.user.id, 'event.create', 'event', id, { name: d.name, mode: d.menu_mode });
    res.status(201).json({ id });
  });
  r.put('/events/:id', need('events.manage'), (req, res) => {
    const id = Number(req.params.id);
    if (!get('SELECT 1 AS x FROM events WHERE id = ?', id)) throw notFound('الفعالية غير موجودة');
    const d = readEvent(req.body || {});
    run('UPDATE events SET name=?, contact_name=?, contact_phone=?, starts_at=?, ends_at=?, menu_mode=?, price_cap=?, order_cap=?, billing=?, needs_approval=?, places=?, notes=?, active=?, welcome_message=?, support_phone=?, support_chat=? WHERE id = ?',
      d.name, d.contact_name, d.contact_phone, d.starts, d.ends, d.menu_mode, d.price_cap, d.order_cap, d.billing, d.needs_approval, d.places, d.notes, d.active, d.welcome_message, d.support_phone, d.support_chat, id);
    saveItems(id, d.menu_mode === 'selected' ? d.item_ids : []);
    audit(req.user.id, 'event.update', 'event', id, { name: d.name, mode: d.menu_mode, active: d.active });
    res.json({ id });
  });
  r.post('/events/:id/active', need('events.manage'), (req, res) => {
    const id = Number(req.params.id);
    const e = get('SELECT name FROM events WHERE id = ?', id);
    if (!e) throw notFound('الفعالية غير موجودة');
    const active = req.body?.active ? 1 : 0;
    run('UPDATE events SET active = ? WHERE id = ?', active, id);
    audit(req.user.id, active ? 'event.resume' : 'event.pause', 'event', id, { name: e.name });
    res.json({ active });
  });
  r.delete('/events/:id', need('events.manage'), (req, res) => {
    const id = Number(req.params.id);
    if (get('SELECT 1 AS x FROM orders WHERE event_id = ?', id)) throw bad('لا يمكن حذف فعالية عليها طلبات، أوقفها بدلاً من ذلك');
    run('DELETE FROM events WHERE id = ?', id);
    audit(req.user.id, 'event.delete', 'event', id);
    res.json({ ok: true });
  });
  r.post('/events/:id/rotate-token', need('events.manage'), (req, res) => {
    const id = Number(req.params.id);
    const e = get('SELECT name FROM events WHERE id = ?', id);
    if (!e) throw notFound('الفعالية غير موجودة');
    const token = randomToken();
    run('UPDATE events SET token = ? WHERE id = ?', token, id);
    audit(req.user.id, 'event.rotate_token', 'event', id, { name: e.name });
    res.json({ token });
  });
  // تحصيل دفعة واحدة من المؤسسة: يسدد كل طلبات الفعالية المفتوحة بالطريقة المختارة
  r.post('/events/:id/settle', need('events.manage'), (req, res) => {
    if (!hasPerm(req.user, 'payments.collect')) return res.status(403).json({ error: 'ليس لديك صلاحية التحصيل' });
    const id = Number(req.params.id);
    const e = get('SELECT * FROM events WHERE id = ?', id);
    if (!e) throw notFound('الفعالية غير موجودة');
    const method = String(req.body?.method || '');
    if (!['cash', 'card', 'wallet'].includes(method)) throw bad('اختر طريقة الدفع');
    let settled = 0; let total = 0; let skipped = 0;
    for (const o of all("SELECT id FROM orders WHERE event_id = ? AND status = 'open' ORDER BY id", id)) {
      const full = Orders.getOrder(o.id);
      const has_items = full.items.some((i) => i.status !== 'cancelled');
      const rem = round2(full.total - full.paid);
      if (full.pending_confirm || !has_items || rem <= 0) { skipped++; continue; }
      Orders.pay(o.id, [{ method, amount: rem }], req.user);
      settled++; total = round2(total + rem);
      emit('public-order', o.id);
    }
    audit(req.user.id, 'event.settle', 'event', id, { name: e.name, method, settled, total, skipped });
    changed('orders', 'tables', 'inventory', 'kitchen');
    res.json({ settled, total, skipped });
  });

  // ───────────── المصاريف (دفتر المحاسبة) ─────────────
  const DEFAULT_EXPENSE_CATS = [
    ['إيجار', 'operating', '#7c3aed', 'building'], ['رواتب وأجور', 'operating', '#0369a1', 'users'], ['كهرباء', 'operating', '#f59e0b', 'zap'], ['ماء', 'operating', '#06b6d4', 'droplets'],
    ['غاز', 'operating', '#ea580c', 'flame'], ['مشتريات مواد خام', 'cogs', '#16a34a', 'basket'], ['صيانة وإصلاحات', 'operating', '#64748b', 'wrench'], ['تسويق وإعلان', 'operating', '#db2777', 'megaphone'],
    ['نقل وتوصيل', 'operating', '#0d9488', 'truck'], ['نظافة ومستلزمات', 'operating', '#84cc16', 'spray'], ['رسوم وتراخيص', 'operating', '#4338ca', 'badge'], ['اتصالات وإنترنت', 'operating', '#2563eb', 'wifi'],
    ['معدات وأجهزة', 'capital', '#9333ea', 'package'], ['أخرى', 'operating', '#78716c', 'receipt'],
  ];
  if (!get('SELECT 1 AS x FROM expense_categories LIMIT 1')) DEFAULT_EXPENSE_CATS.forEach(([n, k, c, i], idx) => run('INSERT INTO expense_categories(name, kind, color, icon, sort) VALUES(?,?,?,?,?)', n, k, c, i, idx));
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const METHODS = ['cash', 'bank', 'card', 'wallet'];
  const canManageExp = (u) => hasPerm(u, 'expenses.manage');
  const needExp = need('expenses.record', 'expenses.manage');
  const readExpense = (b, user) => {
    const amount = round2(Number(b.amount));
    if (!(amount > 0)) throw bad('أدخل مبلغاً صحيحاً');
    const cat = get('SELECT id, active FROM expense_categories WHERE id = ?', Number(b.category_id));
    if (!cat || !cat.active) throw bad('اختر نوع المصروف');
    const date = isDate(b.expense_date) ? b.expense_date : today();
    if (date > today() && !canManageExp(user)) throw bad('لا يمكن تسجيل مصروف بتاريخ مستقبلي');
    const tax = Math.max(0, round2(Number(b.tax) || 0));
    if (tax > amount) throw bad('الضريبة أكبر من المبلغ');
    const method = METHODS.includes(b.method) ? b.method : 'cash';
    return { amount, category_id: cat.id, date, tax, method, vendor: clip(b.vendor, 80) || null, description: clip(b.description, 200) || null, reference: clip(b.reference, 60) || null, from_drawer: b.from_drawer && method === 'cash' ? 1 : 0 };
  };
  const expRows = (where, params) => all(`SELECT e.*, c.name AS category_name, c.color, c.icon, c.kind, u.name AS user_name FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.expense_date DESC, e.id DESC LIMIT 1500`, ...params);

  r.get('/expenses/meta', needExp, (req, res) => {
    res.json({
      categories: all(`SELECT c.*, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS uses FROM expense_categories c ${canManageExp(req.user) && req.query.all ? '' : 'WHERE c.active = 1'} ORDER BY c.sort, c.id`),
      vendors: all("SELECT vendor, COUNT(*) AS n FROM expenses WHERE vendor IS NOT NULL AND vendor != '' GROUP BY vendor ORDER BY MAX(id) DESC LIMIT 40").map((v) => v.vendor),
      shift_open: !!get('SELECT 1 AS x FROM shifts WHERE closed_at IS NULL'),
      manage: canManageExp(req.user),
    });
  });
  r.get('/expenses', needExp, (req, res) => {
    const { from, to, category_id, method, q } = req.query;
    const where = []; const params = [];
    if (!canManageExp(req.user)) { where.push('e.created_by = ?'); params.push(req.user.id); }
    if (isDate(from)) { where.push('e.expense_date >= ?'); params.push(from); }
    if (isDate(to)) { where.push('e.expense_date <= ?'); params.push(to); }
    if (Number(category_id)) { where.push('e.category_id = ?'); params.push(Number(category_id)); }
    if (METHODS.includes(method)) { where.push('e.method = ?'); params.push(method); }
    if (q) { where.push('(e.vendor LIKE ? OR e.description LIKE ? OR e.reference LIKE ?)'); params.push(...Array(3).fill(`%${String(q).trim()}%`)); }
    const rows = expRows(where, params);
    res.json({ rows, total: round2(rows.reduce((a, x) => a + x.amount, 0)), manage: canManageExp(req.user) });
  });
  r.post('/expenses', needExp, (req, res) => {
    const d = readExpense(req.body || {}, req.user);
    let shiftId = null;
    if (d.from_drawer) {
      shiftId = get('SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1')?.id || null;
      if (!shiftId) throw bad('لا توجد وردية مفتوحة لخصم المبلغ من الدرج');
    }
    const info = run('INSERT INTO expenses(expense_date, category_id, amount, tax, method, from_drawer, shift_id, vendor, description, reference, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      d.date, d.category_id, d.amount, d.tax, d.method, d.from_drawer, shiftId, d.vendor, d.description, d.reference, req.user.id);
    const id = Number(info.lastInsertRowid);
    audit(req.user.id, 'expense.create', 'expense', id, { amount: d.amount, category: get('SELECT name FROM expense_categories WHERE id = ?', d.category_id).name, vendor: d.vendor, method: d.method, from_drawer: !!d.from_drawer });
    changed('shift');
    res.status(201).json({ id });
  });
  r.put('/expenses/:id', need('expenses.manage'), (req, res) => {
    const id = Number(req.params.id);
    const old = get('SELECT * FROM expenses WHERE id = ?', id);
    if (!old) throw notFound('المصروف غير موجود');
    const d = readExpense(req.body || {}, req.user);
    let shiftId = old.shift_id;
    if (d.from_drawer && !shiftId) shiftId = get('SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1')?.id || null;
    if (d.from_drawer && !shiftId) throw bad('لا توجد وردية مفتوحة لخصم المبلغ من الدرج');
    if (!d.from_drawer) shiftId = null;
    run('UPDATE expenses SET expense_date=?, category_id=?, amount=?, tax=?, method=?, from_drawer=?, shift_id=?, vendor=?, description=?, reference=?, updated_at=datetime(\'now\',\'localtime\') WHERE id = ?',
      d.date, d.category_id, d.amount, d.tax, d.method, d.from_drawer, shiftId, d.vendor, d.description, d.reference, id);
    audit(req.user.id, 'expense.update', 'expense', id, { from: old.amount, amount: d.amount, vendor: d.vendor });
    changed('shift');
    res.json({ id });
  });
  r.delete('/expenses/:id', need('expenses.manage'), (req, res) => {
    const id = Number(req.params.id);
    const old = get('SELECT e.*, c.name AS category FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?', id);
    if (!old) throw notFound('المصروف غير موجود');
    run('DELETE FROM expenses WHERE id = ?', id);
    audit(req.user.id, 'expense.delete', 'expense', id, { amount: old.amount, category: old.category, vendor: old.vendor, date: old.expense_date });
    changed('shift');
    res.json({ ok: true });
  });

  // أنواع المصاريف
  const readCat = (b) => {
    const name = clip(b.name, 40);
    if (!name) throw bad('أدخل اسم النوع');
    return { name, kind: ['operating', 'cogs', 'capital'].includes(b.kind) ? b.kind : 'operating', color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#64748b', icon: clip(b.icon, 20) || 'receipt' };
  };
  r.post('/expense-categories', need('expenses.manage'), (req, res) => {
    const d = readCat(req.body || {});
    if (get('SELECT 1 AS x FROM expense_categories WHERE name = ?', d.name)) throw bad('يوجد نوع بنفس الاسم');
    const info = run('INSERT INTO expense_categories(name, kind, color, icon, sort) VALUES(?,?,?,?,(SELECT COALESCE(MAX(sort), 0) + 1 FROM expense_categories))', d.name, d.kind, d.color, d.icon);
    audit(req.user.id, 'expense.category_create', 'expense_category', Number(info.lastInsertRowid), { name: d.name, kind: d.kind });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/expense-categories/:id', need('expenses.manage'), (req, res) => {
    const id = Number(req.params.id);
    if (!get('SELECT 1 AS x FROM expense_categories WHERE id = ?', id)) throw notFound('النوع غير موجود');
    const d = readCat(req.body || {});
    if (get('SELECT 1 AS x FROM expense_categories WHERE name = ? AND id != ?', d.name, id)) throw bad('يوجد نوع بنفس الاسم');
    run('UPDATE expense_categories SET name = ?, kind = ?, color = ?, icon = ?, active = ? WHERE id = ?', d.name, d.kind, d.color, d.icon, req.body?.active === false || req.body?.active === 0 ? 0 : 1, id);
    audit(req.user.id, 'expense.category_update', 'expense_category', id, { name: d.name });
    res.json({ id });
  });
  r.delete('/expense-categories/:id', need('expenses.manage'), (req, res) => {
    const id = Number(req.params.id);
    const c = get('SELECT name FROM expense_categories WHERE id = ?', id);
    if (!c) throw notFound('النوع غير موجود');
    if (get('SELECT 1 AS x FROM expenses WHERE category_id = ?', id) || get('SELECT 1 AS x FROM recurring_expenses WHERE category_id = ?', id)) {
      run('UPDATE expense_categories SET active = 0 WHERE id = ?', id);
      audit(req.user.id, 'expense.category_hide', 'expense_category', id, { name: c.name });
      return res.json({ hidden: true });
    }
    run('DELETE FROM expense_categories WHERE id = ?', id);
    audit(req.user.id, 'expense.category_delete', 'expense_category', id, { name: c.name });
    res.json({ deleted: true });
  });

  // المصاريف الثابتة المتكررة (إيجار، رواتب…)
  r.get('/expenses/recurring', need('expenses.manage'), (req, res) => {
    res.json(all(`SELECT t.*, c.name AS category_name, c.color, c.icon,
      (SELECT COUNT(*) FROM expenses e WHERE e.recurring_id = t.id AND substr(e.expense_date, 1, 7) = substr(date('now','localtime'), 1, 7)) AS done_this_month
      FROM recurring_expenses t JOIN expense_categories c ON c.id = t.category_id ORDER BY t.day_of_month, t.id`));
  });
  const readRec = (b) => {
    const name = clip(b.name, 60); const amount = round2(Number(b.amount));
    if (!name) throw bad('أدخل اسم المصروف');
    if (!(amount > 0)) throw bad('أدخل مبلغاً صحيحاً');
    if (!get('SELECT 1 AS x FROM expense_categories WHERE id = ? AND active = 1', Number(b.category_id))) throw bad('اختر نوع المصروف');
    return { name, amount, category_id: Number(b.category_id), method: METHODS.includes(b.method) ? b.method : 'bank', vendor: clip(b.vendor, 80) || null, day: Math.min(28, Math.max(1, parseInt(b.day_of_month, 10) || 1)), active: b.active === false || b.active === 0 ? 0 : 1 };
  };
  r.post('/expenses/recurring', need('expenses.manage'), (req, res) => {
    const d = readRec(req.body || {});
    const info = run('INSERT INTO recurring_expenses(name, category_id, amount, method, vendor, day_of_month, active) VALUES(?,?,?,?,?,?,?)', d.name, d.category_id, d.amount, d.method, d.vendor, d.day, d.active);
    audit(req.user.id, 'expense.recurring_create', 'recurring_expense', Number(info.lastInsertRowid), { name: d.name, amount: d.amount });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/expenses/recurring/:id', need('expenses.manage'), (req, res) => {
    const id = Number(req.params.id);
    if (!get('SELECT 1 AS x FROM recurring_expenses WHERE id = ?', id)) throw notFound('المصروف الثابت غير موجود');
    const d = readRec(req.body || {});
    run('UPDATE recurring_expenses SET name=?, category_id=?, amount=?, method=?, vendor=?, day_of_month=?, active=? WHERE id = ?', d.name, d.category_id, d.amount, d.method, d.vendor, d.day, d.active, id);
    audit(req.user.id, 'expense.recurring_update', 'recurring_expense', id, { name: d.name, amount: d.amount });
    res.json({ id });
  });
  r.delete('/expenses/recurring/:id', need('expenses.manage'), (req, res) => {
    run('DELETE FROM recurring_expenses WHERE id = ?', Number(req.params.id));
    audit(req.user.id, 'expense.recurring_delete', 'recurring_expense', Number(req.params.id));
    res.json({ ok: true });
  });
  // إنشاء قيود شهر معيّن من القوالب (لا يكرر ما أُنشئ)
  r.post('/expenses/recurring/run', need('expenses.manage'), (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? req.body.month : today().slice(0, 7);
    let created = 0; let total = 0;
    for (const t of all('SELECT * FROM recurring_expenses WHERE active = 1')) {
      if (get("SELECT 1 AS x FROM expenses WHERE recurring_id = ? AND substr(expense_date, 1, 7) = ?", t.id, month)) continue;
      run('INSERT INTO expenses(expense_date, category_id, amount, method, vendor, description, recurring_id, created_by) VALUES(?,?,?,?,?,?,?,?)',
        `${month}-${String(t.day_of_month).padStart(2, '0')}`, t.category_id, t.amount, t.method, t.vendor, t.name, t.id, req.user.id);
      created++; total = round2(total + t.amount);
    }
    audit(req.user.id, 'expense.recurring_run', 'expense', null, { month, created, total });
    res.json({ month, created, total });
  });

  // ملخص المحاسبة: المصاريف مقابل المبيعات وصافي الربح التقديري
  r.get('/expenses/summary', need('expenses.manage'), (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : today();
    const to = isDate(req.query.to) ? req.query.to : from;
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);
    const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const pTo = shift(from, -1); const pFrom = shift(from, -days);
    const sum = (a, b) => get('SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c, COALESCE(SUM(tax), 0) AS t FROM expenses WHERE expense_date BETWEEN ? AND ?', a, b);
    const cur = sum(from, to); const prev = sum(pFrom, pTo);
    const byCategory = all(`SELECT c.id, c.name, c.color, c.icon, c.kind, COALESCE(SUM(e.amount), 0) AS total, COUNT(e.id) AS n FROM expense_categories c
      JOIN expenses e ON e.category_id = c.id AND e.expense_date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`, from, to);
    const byMethod = all('SELECT method, SUM(amount) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY method ORDER BY total DESC', from, to);
    const byDay = all('SELECT expense_date AS day, SUM(amount) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date ORDER BY expense_date', from, to);
    const vendors = all("SELECT vendor, SUM(amount) AS total, COUNT(*) AS n FROM expenses WHERE vendor IS NOT NULL AND vendor != '' AND expense_date BETWEEN ? AND ? GROUP BY vendor ORDER BY total DESC LIMIT 5", from, to);
    const drawer = get('SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE from_drawer = 1 AND expense_date BETWEEN ? AND ?', from, to).s;
    const paid = get("SELECT COALESCE(SUM(total), 0) AS s, COALESCE(SUM(tax), 0) AS t FROM orders WHERE status = 'paid' AND date(created_at) BETWEEN ? AND ?", from, to);
    const cogsSales = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id JOIN orders o ON o.id = m.order_id
      WHERE m.type = 'sale' AND o.status = 'paid' AND date(o.created_at) BETWEEN ? AND ?`, from, to).v;
    const kindTotal = (k) => round2(byCategory.filter((c) => c.kind === k).reduce((a, c) => a + c.total, 0));
    const netSales = round2(paid.s - paid.t);
    const operating = kindTotal('operating');
    res.json({
      from, to, days, prev: { from: pFrom, to: pTo, total: round2(prev.s) },
      total: round2(cur.s), count: cur.c, tax_recoverable: round2(cur.t), avg_per_day: round2(cur.s / days), drawer_cash: round2(drawer),
      change_pct: prev.s > 0 ? Math.round(((cur.s - prev.s) / prev.s) * 100) : null,
      byCategory: byCategory.map((c) => ({ ...c, total: round2(c.total) })), byMethod: byMethod.map((m) => ({ ...m, total: round2(m.total) })), byDay: byDay.map((d) => ({ ...d, total: round2(d.total) })),
      topVendors: vendors.map((v) => ({ ...v, total: round2(v.total) })),
      profit: { net_sales: netSales, cogs: round2(cogsSales), gross: round2(netSales - cogsSales), operating, purchases: kindTotal('cogs'), capital: kindTotal('capital'), net: round2(netSales - cogsSales - operating) },
    });
  });

  r.get('/audit', need('activity.view'), (req, res) => {
    const { user_id, category, from, to, q, before } = req.query;
    const where = [];
    const params = [];
    if (user_id) { where.push('a.user_id = ?'); params.push(Number(user_id)); }
    if (category) { where.push('a.action LIKE ?'); params.push(`${category}.%`); }
    if (from) { where.push('date(a.created_at) >= ?'); params.push(from); }
    if (to) { where.push('date(a.created_at) <= ?'); params.push(to); }
    if (before) { where.push('a.id < ?'); params.push(Number(before)); }
    if (q) { where.push('(a.details LIKE ? OR o.code LIKE ? OR u.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const rows = all(`SELECT a.*, u.name AS user_name, u.role AS user_role,
        CASE WHEN a.entity = 'order' THEN o.code END AS order_code,
        CASE WHEN a.entity = 'employee' THEN e.name WHEN a.entity = 'user' THEN tu.name WHEN a.entity = 'item' THEN mi.name WHEN a.entity = 'table' THEN dt.name END AS entity_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN orders o ON a.entity = 'order' AND o.id = a.entity_id
      LEFT JOIN employees e ON a.entity = 'employee' AND e.id = a.entity_id
      LEFT JOIN users tu ON a.entity = 'user' AND tu.id = a.entity_id
      LEFT JOIN menu_items mi ON a.entity = 'item' AND mi.id = a.entity_id
      LEFT JOIN dining_tables dt ON a.entity = 'table' AND dt.id = a.entity_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.id DESC LIMIT ?`, ...params, limit + 1);
    const more = rows.length > limit;
    res.json({ rows: rows.slice(0, limit).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })), more });
  });

  return r;
}

function mapRound(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'number' && !Number.isInteger(v) ? round2(v) : normalize(v);
  return out;
}
