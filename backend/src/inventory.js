// محرّك المخازن: حركات وارد/صادر/تالف/جرد، دفعات بتواريخ صلاحية (الأقدم صلاحية أولاً FEFO)، وتحليلات الإدارة
import { get, all, run, tx } from './db.js';
import { bad, notFound, round2 } from './util.js';

export const MOVE_LABEL = { purchase: 'وارد', sale: 'بيع', waste: 'تالف', adjust: 'جرد', issue: 'صرف', return: 'مرتجع للمورد' };
export const WASTE_REASONS = ['انتهاء الصلاحية', 'تلف / فساد', 'سوء تخزين', 'خطأ في التحضير', 'سقوط / انسكاب', 'عينة / تجربة', 'أخرى'];
export const ISSUE_REASONS = ['تحضير داخلي', 'ضيافة', 'عينات وتجارب', 'استخدام تشغيلي', 'تحويل لفرع آخر', 'أخرى'];
export const CATEGORIES = ['لحوم ودواجن', 'خضار وفواكه', 'ألبان وبيض', 'مواد جافة', 'مخبوزات', 'مشروبات', 'صلصات وتوابل', 'تغليف ومستهلكات'];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayYmd = () => ymd(new Date());
export const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return ymd(d); };
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** يخصم الكمية من الدفعات: الدفعة المحددة أولاً (إن وُجدت) ثم الأقدم صلاحية؛ ما زاد عن الدفعات يُخصم من الرصيد غير المُدفَّع */
function consume(ingredientId, qty, batchId = null) {
  let left = qty;
  let first = null;
  const take = (b) => {
    const t = Math.min(b.qty_left, left);
    if (t <= 0) return;
    run('UPDATE stock_batches SET qty_left = qty_left - ? WHERE id = ?', t, b.id);
    left = r3(left - t);
    if (first == null) first = b.id;
  };
  if (batchId) { const b = get('SELECT * FROM stock_batches WHERE id = ? AND ingredient_id = ?', batchId, ingredientId); if (b) take(b); }
  if (left > 0) {
    for (const b of all('SELECT * FROM stock_batches WHERE ingredient_id = ? AND qty_left > 0 ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, id', ingredientId)) {
      if (left <= 0) break;
      take(b);
    }
  }
  return first;
}

/**
 * يسجّل حركة مخزون ويحدّث الرصيد والدفعات: qty بإشارتها (موجب وارد / سالب صادر)
 * يُرجع رقم الحركة. التكلفة الافتراضية للصادر = متوسط تكلفة المادة الحالية.
 */
export function recordMovement({ ingredient_id, qty, type, user_id = null, unit_cost = null, reason = null, note = null, order_id = null, batch_id = null, receipt_id = null, supplier_id = null, stocktake_id = null }) {
  const ing = get('SELECT * FROM ingredients WHERE id = ?', ingredient_id);
  if (!ing) throw notFound('المادة غير موجودة');
  const delta = r3(qty);
  let usedBatch = batch_id;
  if (delta < 0) usedBatch = consume(ing.id, -delta, batch_id) ?? batch_id;
  run('UPDATE ingredients SET stock = stock + ? WHERE id = ?', delta, ing.id);
  const bal = get('SELECT stock FROM ingredients WHERE id = ?', ing.id).stock;
  const cost = unit_cost != null ? Number(unit_cost) : ing.cost_per_unit;
  const info = run(`INSERT INTO stock_movements(ingredient_id, qty, type, unit_cost, note, order_id, user_id, reason, batch_id, receipt_id, supplier_id, stocktake_id, balance_after)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, ing.id, delta, type, cost, note, order_id, user_id, reason, usedBatch, receipt_id, supplier_id, stocktake_id, r3(bal));
  return Number(info.lastInsertRowid);
}

/** استلام بضاعة: مستند + دفعة لكل سطر + حركات وارد + متوسط التكلفة المرجّح */
export function receive({ supplier_id = null, invoice_no = null, received_at, note = null, lines }, user) {
  if (!Array.isArray(lines) || !lines.length) throw bad('أضف سطراً واحداً على الأقل');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(received_at || '')) ? received_at : todayYmd();
  if (supplier_id && !get('SELECT 1 AS x FROM suppliers WHERE id = ?', supplier_id)) throw bad('المورد غير موجود');
  return tx(() => {
    const rid = Number(run('INSERT INTO stock_receipts(supplier_id, invoice_no, received_at, note, user_id) VALUES(?,?,?,?,?)', supplier_id || null, String(invoice_no || '').trim().slice(0, 40) || null, date, note ? String(note).slice(0, 200) : null, user?.id ?? null).lastInsertRowid);
    let total = 0;
    const out = [];
    for (const l of lines) {
      const ing = get('SELECT * FROM ingredients WHERE id = ? AND active = 1', Number(l.ingredient_id));
      if (!ing) throw bad('مادة غير موجودة في أحد الأسطر');
      const qty = Number(l.qty);
      if (!(qty > 0)) throw bad(`كمية «${ing.name}» يجب أن تكون موجبة`);
      const cost = Number(l.unit_cost) >= 0 && l.unit_cost !== '' && l.unit_cost != null ? Number(l.unit_cost) : ing.cost_per_unit;
      let expiry = /^\d{4}-\d{2}-\d{2}$/.test(String(l.expiry_date || '')) ? l.expiry_date : null;
      if (!expiry && ing.shelf_life_days > 0) expiry = addDays(Number(ing.shelf_life_days), new Date(`${date}T00:00`));
      if (expiry && expiry < date) throw bad(`تاريخ صلاحية «${ing.name}» أقدم من تاريخ الاستلام`);
      const bid = Number(run('INSERT INTO stock_batches(ingredient_id, receipt_id, supplier_id, qty_in, qty_left, unit_cost, received_at, expiry_date) VALUES(?,?,?,?,?,?,?,?)', ing.id, rid, supplier_id || null, qty, qty, cost, date, expiry).lastInsertRowid);
      // متوسط التكلفة المرجّح
      const base = Math.max(ing.stock, 0);
      const avg = base + qty > 0 ? (base * ing.cost_per_unit + qty * cost) / (base + qty) : cost;
      run('UPDATE ingredients SET cost_per_unit = ?, supplier_id = COALESCE(?, supplier_id) WHERE id = ?', Math.round(avg * 1000) / 1000, supplier_id || null, ing.id);
      recordMovement({ ingredient_id: ing.id, qty, type: 'purchase', user_id: user?.id, unit_cost: cost, note: note || null, batch_id: bid, receipt_id: rid, supplier_id: supplier_id || null });
      total += qty * cost;
      out.push({ ingredient_id: ing.id, name: ing.name, qty, unit: ing.unit, unit_cost: cost, expiry_date: expiry, batch_id: bid });
    }
    run('UPDATE stock_receipts SET total = ? WHERE id = ?', round2(total), rid);
    return { id: rid, total: round2(total), lines: out };
  });
}

/** يشطب الكمية المتبقية من دفعة (منتهية الصلاحية غالباً) كتالف */
export function discardBatch(batchId, user, reason = 'انتهاء الصلاحية', note = null) {
  const b = get('SELECT * FROM stock_batches WHERE id = ?', batchId);
  if (!b) throw notFound('الدفعة غير موجودة');
  if (!(b.qty_left > 0)) throw bad('لا يوجد رصيد متبقٍ في هذه الدفعة');
  return tx(() => recordMovement({ ingredient_id: b.ingredient_id, qty: -b.qty_left, type: 'waste', user_id: user.id, unit_cost: b.unit_cost, reason, note, batch_id: b.id }));
}

/** جرد: مصفوفة {ingredient_id, qty} بالكميات الفعلية؛ يسجّل فرق كل مادة ويُرجع قيمة العجز والزيادة */
export function stocktake(counts, note, user) {
  if (!Array.isArray(counts) || !counts.length) throw bad('أدخل كميات الجرد');
  return tx(() => {
    const sid = Number(run('INSERT INTO stocktakes(user_id, note) VALUES(?,?)', user.id, note ? String(note).slice(0, 200) : null).lastInsertRowid);
    let shortage = 0; let surplus = 0; let changed = 0;
    const lines = [];
    for (const c of counts) {
      const ing = get('SELECT * FROM ingredients WHERE id = ? AND active = 1', Number(c.ingredient_id));
      if (!ing || c.qty === '' || c.qty == null) continue;
      const actual = Number(c.qty);
      if (!(actual >= 0)) throw bad(`كمية «${ing.name}» غير صحيحة`);
      const diff = r3(actual - ing.stock);
      lines.push({ ingredient_id: ing.id, name: ing.name, unit: ing.unit, system: ing.stock, actual, diff, value: round2(diff * ing.cost_per_unit) });
      if (Math.abs(diff) < 0.0005) continue;
      recordMovement({ ingredient_id: ing.id, qty: diff, type: 'adjust', user_id: user.id, reason: diff < 0 ? 'عجز جرد' : 'زيادة جرد', note: note || null, stocktake_id: sid });
      changed++;
      if (diff < 0) shortage += -diff * ing.cost_per_unit; else surplus += diff * ing.cost_per_unit;
    }
    run('UPDATE stocktakes SET items = ?, shortage_value = ?, surplus_value = ? WHERE id = ?', lines.length, round2(shortage), round2(surplus), sid);
    return { id: sid, counted: lines.length, changed, shortage_value: round2(shortage), surplus_value: round2(surplus), lines };
  });
}

/** المواد مع كل مؤشرات الإدارة: القيمة، الصلاحية، الاستهلاك اليومي وأيام التغطية */
export function ingredientsFull() {
  const t = todayYmd();
  const soon = addDays(7);
  return all(`
    SELECT i.*, s.name AS supplier_name,
      (i.stock <= i.min_stock) AS low, (i.stock <= 0) AS out,
      ROUND(MAX(i.stock, 0) * i.cost_per_unit, 2) AS value,
      (SELECT MIN(expiry_date) FROM stock_batches b WHERE b.ingredient_id = i.id AND b.qty_left > 0 AND b.expiry_date IS NOT NULL) AS nearest_expiry,
      (SELECT COALESCE(SUM(qty_left), 0) FROM stock_batches b WHERE b.ingredient_id = i.id AND b.qty_left > 0 AND b.expiry_date < ?) AS expired_qty,
      (SELECT COALESCE(SUM(qty_left), 0) FROM stock_batches b WHERE b.ingredient_id = i.id AND b.qty_left > 0 AND b.expiry_date >= ? AND b.expiry_date <= ?) AS soon_qty,
      (SELECT COUNT(*) FROM stock_batches b WHERE b.ingredient_id = i.id AND b.qty_left > 0) AS batches,
      (SELECT COALESCE(SUM(-m.qty), 0) / 14.0 FROM stock_movements m WHERE m.ingredient_id = i.id AND m.type IN ('sale','issue') AND date(m.created_at) >= date('now','localtime','-14 days')) AS avg_daily,
      (SELECT MAX(created_at) FROM stock_movements m WHERE m.ingredient_id = i.id AND m.type = 'purchase') AS last_purchase_at
    FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.active = 1 ORDER BY i.name`, t, t, soon).map((i) => ({
    ...i, low: !!i.low, out: !!i.out,
    avg_daily: r3(i.avg_daily),
    days_cover: i.avg_daily > 0 ? Math.round((Math.max(i.stock, 0) / i.avg_daily) * 10) / 10 : null,
  }));
}

/** نظرة الإدارة: المؤشرات والتنبيهات والتدفق اليومي وأسباب التالف واقتراحات إعادة الطلب */
export function overview() {
  const t = todayYmd();
  const soon = addDays(7);
  const ings = ingredientsFull();
  const value = ings.reduce((a, i) => a + i.value, 0);
  const byCategory = {};
  for (const i of ings) { const k = i.category || 'غير مصنّف'; byCategory[k] = round2((byCategory[k] || 0) + i.value); }

  const batchRows = all(`SELECT b.id, b.ingredient_id, i.name, i.unit, b.qty_left, b.unit_cost, b.expiry_date, b.received_at
    FROM stock_batches b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.qty_left > 0 AND b.expiry_date IS NOT NULL AND i.active = 1 ORDER BY b.expiry_date`);
  const expired = batchRows.filter((b) => b.expiry_date < t);
  const expiring = batchRows.filter((b) => b.expiry_date >= t && b.expiry_date <= soon);
  const val = (rows) => round2(rows.reduce((a, b) => a + b.qty_left * (b.unit_cost || 0), 0));

  const days = Array.from({ length: 14 }, (_, k) => addDays(k - 13));
  const flowRows = all(`SELECT date(m.created_at) AS d, m.type, SUM(ABS(m.qty) * COALESCE(m.unit_cost, i.cost_per_unit)) AS v
    FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
    WHERE date(m.created_at) >= ? AND m.type IN ('purchase','sale','issue','waste','return') GROUP BY d, m.type`, days[0]);
  const flow = days.map((d) => {
    const g = (types) => round2(flowRows.filter((r) => r.d === d && types.includes(r.type)).reduce((a, r) => a + r.v, 0));
    return { day: d, in: g(['purchase']), out: g(['sale', 'issue', 'return']), waste: g(['waste']) };
  });
  const monthStart = `${t.slice(0, 8)}01`;
  const waste = all(`SELECT COALESCE(m.reason, 'غير محدد') AS reason, SUM(-m.qty * COALESCE(m.unit_cost, i.cost_per_unit)) AS value, COUNT(*) AS n
    FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'waste' AND date(m.created_at) >= ? GROUP BY reason ORDER BY value DESC`, monthStart).map((r) => ({ ...r, value: round2(r.value) }));
  const monthIn = get(`SELECT COALESCE(SUM(m.qty * COALESCE(m.unit_cost, i.cost_per_unit)), 0) AS v FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'purchase' AND date(m.created_at) >= ?`, monthStart).v;
  const wasteTotal = round2(waste.reduce((a, r) => a + r.value, 0));
  const topWaste = all(`SELECT i.name, i.unit, SUM(-m.qty) AS qty, SUM(-m.qty * COALESCE(m.unit_cost, i.cost_per_unit)) AS value
    FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'waste' AND date(m.created_at) >= ? GROUP BY i.id ORDER BY value DESC LIMIT 5`, monthStart).map((r) => ({ ...r, qty: r3(r.qty), value: round2(r.value) }));
  const topUsed = all(`SELECT i.name, i.unit, SUM(-m.qty) AS qty, SUM(-m.qty * COALESCE(m.unit_cost, i.cost_per_unit)) AS value
    FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type IN ('sale','issue') AND date(m.created_at) >= date('now','localtime','-14 days') GROUP BY i.id ORDER BY value DESC LIMIT 6`).map((r) => ({ ...r, qty: r3(r.qty), value: round2(r.value) }));

  // اقتراحات إعادة الطلب: كل ما نزل عن الحد الأدنى، بالكمية اللازمة للوصول للمستهدف، مجمّعة حسب المورد
  const suggestions = ings.filter((i) => i.stock <= i.min_stock).map((i) => {
    const target = i.par_level > 0 ? i.par_level : Math.max(i.min_stock * 2, 1);
    const need = Math.max(0, r3(target - Math.max(i.stock, 0)));
    return { ingredient_id: i.id, name: i.name, unit: i.unit, stock: i.stock, min_stock: i.min_stock, target, need, est_cost: round2(need * i.cost_per_unit), supplier_id: i.supplier_id, supplier_name: i.supplier_name, days_cover: i.days_cover };
  }).filter((s) => s.need > 0);

  const todayMoves = all(`SELECT m.type, SUM(ABS(m.qty) * COALESCE(m.unit_cost, i.cost_per_unit)) AS v, COUNT(*) AS n FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE date(m.created_at) = ? GROUP BY m.type`, t);
  return {
    kpis: {
      value: round2(value), items: ings.length, low: ings.filter((i) => i.low && !i.out).length, out: ings.filter((i) => i.out).length,
      expired: expired.length, expired_value: val(expired), expiring: expiring.length, expiring_value: val(expiring),
      waste_month: wasteTotal, waste_pct: monthIn > 0 ? Math.round((wasteTotal / monthIn) * 1000) / 10 : 0, purchases_month: round2(monthIn),
      today_in: round2(todayMoves.filter((x) => x.type === 'purchase').reduce((a, x) => a + x.v, 0)),
      today_out: round2(todayMoves.filter((x) => ['sale', 'issue', 'return'].includes(x.type)).reduce((a, x) => a + x.v, 0)),
      today_waste: round2(todayMoves.filter((x) => x.type === 'waste').reduce((a, x) => a + x.v, 0)),
    },
    by_category: Object.entries(byCategory).map(([name, v]) => ({ name, value: v })).sort((a, b) => b.value - a.value),
    flow, waste_by_reason: waste, top_waste: topWaste, top_used: topUsed,
    expiry: { expired: expired.slice(0, 12), expiring: expiring.slice(0, 12) },
    low_items: ings.filter((i) => i.low).slice(0, 12).map((i) => ({ id: i.id, name: i.name, unit: i.unit, stock: i.stock, min_stock: i.min_stock, out: i.out, days_cover: i.days_cover })),
    suggestions,
  };
}
