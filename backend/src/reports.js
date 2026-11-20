// التقارير: نظرة شاملة بفلاتر ذكية ومقارنة بالفترة السابقة
import { get, all } from './db.js';
import { need } from './perms.js';
import { round2, today } from './util.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => new Date(`${s}T00:00:00`);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(parse(s).getTime());
const rd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]));

/** الأيام بين تاريخين شاملة */
function daysBetween(from, to) {
  const out = [];
  for (let t = parse(from).getTime(); t <= parse(to).getTime() && out.length < 800; t += DAY) out.push(fmt(new Date(t)));
  return out;
}

/** الفترة السابقة المطابقة في الطول وتنتهي قبل بداية الحالية */
export function previousRange(from, to) {
  const n = daysBetween(from, to).length;
  const end = new Date(parse(from).getTime() - DAY);
  const start = new Date(end.getTime() - (n - 1) * DAY);
  return { from: fmt(start), to: fmt(end) };
}

/** شروط الفلاتر على الطلبات (o) */
function filterSql(q) {
  const w = [];
  const p = [];
  if (q.type) { w.push('o.type = ?'); p.push(q.type); }
  if (q.staff) { w.push('o.waiter_id = ?'); p.push(Number(q.staff)); }
  if (q.source) { w.push('o.source = ?'); p.push(q.source); }
  if (q.event === 'any') w.push('o.event_id IS NOT NULL');
  else if (q.event === 'none') w.push('o.event_id IS NULL');
  else if (q.event) { w.push('o.event_id = ?'); p.push(Number(q.event)); }
  if (q.area) { w.push('o.table_id IN (SELECT id FROM dining_tables WHERE area = ?)'); p.push(q.area); }
  if (q.method) { w.push('EXISTS (SELECT 1 FROM payments pp WHERE pp.order_id = o.id AND pp.method = ?)'); p.push(q.method); }
  if (q.category) {
    w.push('EXISTS (SELECT 1 FROM order_items xi JOIN menu_items xm ON xm.id = xi.item_id WHERE xi.order_id = o.id AND xi.status != \'cancelled\' AND xm.category_id = ?)');
    p.push(Number(q.category));
  }
  if (q.hour_from !== undefined && q.hour_from !== '' && q.hour_to !== undefined && q.hour_to !== '') {
    w.push("CAST(strftime('%H', o.created_at) AS INTEGER) BETWEEN ? AND ?");
    p.push(Number(q.hour_from), Number(q.hour_to));
  }
  return { sql: w.length ? ` AND ${w.join(' AND ')}` : '', params: p };
}

/** مؤشرات فترة واحدة (تُستعمل للحالية والسابقة) */
function kpis(from, to, f) {
  const base = `o.status = 'paid' AND date(o.created_at) BETWEEN ? AND ?${f.sql}`;
  const args = [from, to, ...f.params];
  const t = get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(discount),0) AS discounts,
    COALESCE(SUM(service),0) AS service, COALESCE(SUM(delivery_fee),0) AS delivery, COALESCE(SUM(subtotal),0) AS subtotal,
    COALESCE(SUM(guests),0) AS guests, COALESCE(AVG(total),0) AS avg_ticket FROM orders o WHERE ${base}`, ...args);
  const cx = get(`SELECT COUNT(*) AS c, COALESCE(SUM(subtotal),0) AS v FROM orders o WHERE o.status = 'cancelled' AND date(o.created_at) BETWEEN ? AND ?${f.sql}`, ...args);
  const cogs = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
    JOIN orders o ON o.id = m.order_id WHERE m.type = 'sale' AND ${base}`, ...args).v;
  const waste = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
    WHERE m.type = 'waste' AND date(m.created_at) BETWEEN ? AND ?`, from, to).v;
  const exp = get('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE expense_date BETWEEN ? AND ?', from, to).v;
  const net = t.sales - t.tax;
  const gross = net - cogs;
  return {
    sales: t.sales, orders: t.orders, avg_ticket: t.avg_ticket, net_sales: net, tax: t.tax, discounts: t.discounts, service: t.service, delivery: t.delivery,
    guests: t.guests, per_guest: t.guests ? t.sales / t.guests : 0, cogs, gross_profit: gross, margin: net > 0 ? (gross / net) * 100 : 0,
    cancelled: cx.c, cancelled_value: cx.v, discount_rate: t.subtotal > 0 ? (t.discounts / t.subtotal) * 100 : 0,
    waste, expenses: exp, net_profit: gross - waste - exp,
  };
}

/** مبيعات كل يوم (مملوءة بالأصفار) */
function dailySeries(from, to, f) {
  const rows = all(`SELECT date(o.created_at) AS day, COUNT(*) AS orders, SUM(total) AS total FROM orders o
    WHERE o.status = 'paid' AND date(o.created_at) BETWEEN ? AND ?${f.sql} GROUP BY day`, from, to, ...f.params);
  const m = Object.fromEntries(rows.map((r) => [r.day, r]));
  return daysBetween(from, to).map((d) => ({ day: d, orders: m[d]?.orders || 0, total: round2(m[d]?.total || 0) }));
}

export function reportRoutes(r) {
  r.get('/reports/overview', need('reports.view'), (req, res) => {
    const q = req.query;
    let from = isDate(q.from) ? q.from : today();
    let to = isDate(q.to) ? q.to : from;
    if (from > to) [from, to] = [to, from];
    const f = filterSql(q);
    const base = `o.status = 'paid' AND date(o.created_at) BETWEEN ? AND ?${f.sql}`;
    const args = [from, to, ...f.params];
    const days = daysBetween(from, to);

    const cur = kpis(from, to, f);
    const prevR = previousRange(from, to);
    const prev = kpis(prevR.from, prevR.to, f);
    const series = dailySeries(from, to, f);
    const prevSeries = dailySeries(prevR.from, prevR.to, f);

    const byHour = all(`SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS total FROM orders o WHERE ${base} GROUP BY hour ORDER BY hour`, ...args);
    const heat = all(`SELECT CAST(strftime('%w', o.created_at) AS INTEGER) AS dow, CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS total
      FROM orders o WHERE ${base} GROUP BY dow, hour`, ...args);
    const byWeekday = all(`SELECT CAST(strftime('%w', o.created_at) AS INTEGER) AS dow, COUNT(*) AS orders, SUM(total) AS total, COUNT(DISTINCT date(o.created_at)) AS days
      FROM orders o WHERE ${base} GROUP BY dow ORDER BY dow`, ...args);
    const byType = all(`SELECT type, COUNT(*) AS orders, SUM(total) AS total, AVG(total) AS avg FROM orders o WHERE ${base} GROUP BY type ORDER BY total DESC`, ...args);
    const bySource = all(`SELECT source, COUNT(*) AS orders, SUM(total) AS total FROM orders o WHERE ${base} GROUP BY source ORDER BY total DESC`, ...args);
    const byArea = all(`SELECT COALESCE(t.area, 'بدون منطقة') AS area, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN dining_tables t ON t.id = o.table_id
      WHERE ${base} GROUP BY t.area ORDER BY total DESC`, ...args);
    const byTable = all(`SELECT t.name, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN dining_tables t ON t.id = o.table_id
      WHERE ${base} GROUP BY t.id ORDER BY total DESC LIMIT 8`, ...args);
    const byEvent = all(`SELECT e.id, e.name, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN events e ON e.id = o.event_id
      WHERE ${base} GROUP BY e.id ORDER BY total DESC LIMIT 8`, ...args);
    const byPayment = all(`SELECT p.method, COUNT(*) AS n, SUM(p.amount) AS total,
      SUM(CASE WHEN p.verify_status = 'confirmed' THEN p.amount ELSE 0 END) AS confirmed,
      SUM(CASE WHEN p.verify_status IN ('pending','mismatch') THEN p.amount ELSE 0 END) AS unverified
      FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${base} GROUP BY p.method ORDER BY total DESC`, ...args);

    const lineBase = `${base} AND oi.status != 'cancelled'${q.category ? ' AND m.category_id = ?' : ''}`;
    const lineArgs = q.category ? [...args, Number(q.category)] : args;
    const lineFrom = 'FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN menu_items m ON m.id = oi.item_id LEFT JOIN categories c ON c.id = m.category_id';
    const items = all(`SELECT oi.item_id AS id, oi.name, c.name AS category, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price) AS total, COUNT(DISTINCT oi.order_id) AS orders
      ${lineFrom} WHERE ${lineBase} GROUP BY oi.item_id ORDER BY qty DESC`, ...lineArgs);
    const byCategory = all(`SELECT c.id, COALESCE(c.name, 'بدون فئة') AS name, SUM(oi.qty * oi.price) AS total, SUM(oi.qty) AS qty
      ${lineFrom} WHERE ${lineBase} GROUP BY c.id ORDER BY total DESC`, ...lineArgs);
    const itemTotal = items.reduce((a, i) => a + i.total, 0);
    const sold = new Set(items.map((i) => i.id));
    const unsold = all(`SELECT m.id, m.name, c.name AS category FROM menu_items m LEFT JOIN categories c ON c.id = m.category_id
      WHERE m.active = 1${q.category ? ' AND m.category_id = ?' : ''} ORDER BY m.name`, ...(q.category ? [Number(q.category)] : [])).filter((m) => !sold.has(m.id)).slice(0, 12);

    const byStaff = all(`SELECT u.id, u.name, COUNT(*) AS orders, SUM(o.total) AS total, AVG(o.total) AS avg, SUM(o.discount) AS discounts
      FROM orders o JOIN users u ON u.id = o.waiter_id WHERE ${base} GROUP BY u.id ORDER BY total DESC`, ...args);
    const cashiers = all(`SELECT u.name, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN users u ON u.id = o.cashier_id
      WHERE ${base} GROUP BY u.id ORDER BY total DESC LIMIT 6`, ...args);

    const discounts = {
      orders: get(`SELECT COUNT(*) AS c FROM orders o WHERE ${base} AND o.discount > 0`, ...args).c,
      top: all(`SELECT o.id, o.code, o.discount, o.total, o.discount_type, o.discount_value, u.name AS waiter_name FROM orders o LEFT JOIN users u ON u.id = o.waiter_id
        WHERE ${base} AND o.discount > 0 ORDER BY o.discount DESC LIMIT 6`, ...args),
    };
    const cancels = {
      reasons: all(`SELECT COALESCE(NULLIF(o.cancel_reason, ''), 'بدون سبب') AS reason, COUNT(*) AS n, SUM(o.subtotal) AS value FROM orders o
        WHERE o.status = 'cancelled' AND date(o.created_at) BETWEEN ? AND ?${f.sql} GROUP BY reason ORDER BY n DESC LIMIT 6`, ...args),
      items: get(`SELECT COUNT(*) AS c FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.status = 'cancelled' AND date(o.created_at) BETWEEN ? AND ?${f.sql}`, ...args).c,
    };

    const expTotal = cur.expenses;
    const expenses = {
      by_category: all(`SELECT c.name, c.color, c.kind, SUM(e.amount) AS total, COUNT(*) AS n FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
        WHERE e.expense_date BETWEEN ? AND ? GROUP BY c.id ORDER BY total DESC`, from, to),
      by_vendor: all(`SELECT vendor, SUM(amount) AS total, COUNT(*) AS n FROM expenses WHERE expense_date BETWEEN ? AND ? AND vendor IS NOT NULL AND vendor != ''
        GROUP BY vendor ORDER BY total DESC LIMIT 6`, from, to),
      by_method: all('SELECT method, SUM(amount) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY method ORDER BY total DESC', from, to),
      by_day: all('SELECT expense_date AS day, SUM(amount) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date ORDER BY expense_date', from, to),
    };

    const inventory = {
      purchases: get(`SELECT COALESCE(SUM(m.qty * COALESCE(b.unit_cost, i.cost_per_unit)),0) AS v FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
        LEFT JOIN stock_batches b ON b.id = m.batch_id WHERE m.type = 'purchase' AND date(m.created_at) BETWEEN ? AND ?`, from, to).v,
      waste_by_reason: all(`SELECT COALESCE(NULLIF(m.reason, ''), 'غير محدد') AS reason, SUM(-m.qty * i.cost_per_unit) AS value, COUNT(*) AS n FROM stock_movements m
        JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'waste' AND date(m.created_at) BETWEEN ? AND ? GROUP BY reason ORDER BY value DESC LIMIT 6`, from, to),
      waste_top: all(`SELECT i.name, SUM(-m.qty) AS qty, i.unit, SUM(-m.qty * i.cost_per_unit) AS value FROM stock_movements m
        JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'waste' AND date(m.created_at) BETWEEN ? AND ? GROUP BY i.id ORDER BY value DESC LIMIT 6`, from, to),
      low: all('SELECT id, name, unit, stock, min_stock FROM ingredients WHERE active = 1 AND stock <= min_stock ORDER BY (stock * 1.0 / NULLIF(min_stock, 0)), name LIMIT 8'),
      value: get('SELECT COALESCE(SUM(stock * cost_per_unit),0) AS v FROM ingredients WHERE active = 1').v,
    };

    const custBase = `${base} AND o.customer_id IS NOT NULL`;
    const customers = {
      with_customer: get(`SELECT COUNT(*) AS c FROM orders o WHERE ${custBase}`, ...args).c,
      unique: get(`SELECT COUNT(DISTINCT o.customer_id) AS c FROM orders o WHERE ${custBase}`, ...args).c,
      new: get('SELECT COUNT(*) AS c FROM customers WHERE date(created_at) BETWEEN ? AND ?', from, to).c,
      top: all(`SELECT c.id, c.name, c.phone, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE ${custBase} GROUP BY c.id ORDER BY total DESC LIMIT 6`, ...args),
    };
    customers.repeat = get(`SELECT COUNT(*) AS c FROM (SELECT o.customer_id FROM orders o WHERE ${custBase} GROUP BY o.customer_id HAVING COUNT(*) > 1)`, ...args).c;

    const best = [...series].sort((a, b) => b.total - a.total)[0];
    const peak = [...byHour].sort((a, b) => b.total - a.total)[0];

    const meta = {
      staff: all("SELECT id, name FROM users WHERE role IN ('waiter','cashier','admin','manager') AND active = 1 ORDER BY name"),
      categories: all('SELECT id, name FROM categories WHERE active = 1 ORDER BY sort, name'),
      events: all('SELECT id, name FROM events ORDER BY id DESC LIMIT 30'),
      areas: all("SELECT DISTINCT area FROM dining_tables WHERE active = 1 AND area IS NOT NULL AND area != '' ORDER BY area").map((a) => a.area),
    };

    res.json({
      range: { from, to, days: days.length }, previous: prevR,
      filters: Object.fromEntries(['type', 'staff', 'source', 'event', 'area', 'method', 'category', 'hour_from', 'hour_to'].filter((k) => q[k] !== undefined && q[k] !== '').map((k) => [k, q[k]])),
      kpis: rd(cur), prev_kpis: rd(prev),
      series, prev_series: prevSeries,
      best_day: best && best.total > 0 ? best : null, peak_hour: peak ? { hour: peak.hour, total: round2(peak.total), orders: peak.orders } : null,
      by_hour: byHour.map(rd), heat: heat.map(rd), by_weekday: byWeekday.map(rd),
      by_type: byType.map(rd), by_source: bySource.map(rd), by_area: byArea.map(rd), by_table: byTable.map(rd), by_event: byEvent.map(rd), by_payment: byPayment.map(rd),
      items: items.slice(0, 15).map(rd), bottom_items: [...items].reverse().slice(0, 6).map(rd), by_category: byCategory.map((c) => ({ ...rd(c), share: itemTotal ? round2((c.total / itemTotal) * 100) : 0 })),
      unsold, items_count: items.length,
      staff: byStaff.map(rd), cashiers: cashiers.map(rd),
      discounts: { ...discounts, top: discounts.top.map(rd) }, cancels: { ...cancels, reasons: cancels.reasons.map(rd) },
      expenses: { total: round2(expTotal), by_category: expenses.by_category.map(rd), by_vendor: expenses.by_vendor.map(rd), by_method: expenses.by_method.map(rd), by_day: expenses.by_day.map(rd) },
      inventory: { ...inventory, purchases: round2(inventory.purchases), value: round2(inventory.value), waste_by_reason: inventory.waste_by_reason.map(rd), waste_top: inventory.waste_top.map(rd) },
      customers: { ...customers, top: customers.top.map(rd) },
      meta,
    });
  });
}
