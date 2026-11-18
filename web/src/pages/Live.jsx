import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radio, QrCode, Clock, Users, ShieldQuestion, NotepadText, ChefHat, Flame, BellRing, HandPlatter, ReceiptText, X, ExternalLink, History, Timer, Armchair, ShoppingBag, Bike, TriangleAlert, Plus,
} from 'lucide-react';
import { useData, useMoney, useNow, Empty, Loading, ORDER_TYPES } from '../lib.jsx';
import { TableArt, useTween, AnimatedMoney } from '../components/TableHero.jsx';
import OrderTimeline from '../components/OrderTimeline.jsx';
import { describe, tone } from './Activity.jsx';

// مراحل الطلب بالترتيب (من الزبون حتى الحساب)
const STAGES = [
  ['confirm', 'بانتظار التأكيد', ShieldQuestion],
  ['draft', 'لم يُرسل', NotepadText],
  ['new', 'في المطبخ', ChefHat],
  ['preparing', 'قيد التحضير', Flame],
  ['ready', 'جاهز', BellRing],
  ['served', 'تم التقديم', HandPlatter],
  ['bill', 'طلب الحساب', ReceiptText],
];
const STAGE_LABEL = Object.fromEntries(STAGES.map(([k, l]) => [k, l]));
const TYPE_ICON = { dine_in: Armchair, takeaway: ShoppingBag, delivery: Bike };
const ts = (s) => (s ? new Date(String(s).replace(' ', 'T')).getTime() : Date.now());
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function Num({ value, digits = 0 }) {
  const v = useTween(Number(value) || 0);
  return <>{digits ? v.toFixed(digits) : Math.round(v)}</>;
}

/** المتابعة المباشرة: لوحة إنفوجرافيك تفاعلية تُحدَّث لحظة بلحظة */
export default function Live() {
  const navigate = useNavigate();
  const money = useMoney();
  const { data, loading } = useData('/live', ['orders', 'kitchen', 'tables', 'shift', 'reservations'], []);
  const feed = useData('/audit?limit=24', ['orders', 'kitchen', 'tables', 'settings'], []);
  const [sel, setSel] = useState(null);          // { kind: 'order'|'table', id }
  const [stage, setStage] = useState(null);      // مرحلة مختارة لإبراز طاولاتها
  const [area, setArea] = useState('all');
  const [timeline, setTimeline] = useState(null);
  const [updated, setUpdated] = useState(Date.now());
  useNow(1000);                                  // عدّادات تتحرك كل ثانية
  useEffect(() => { if (data) setUpdated(Date.now()); }, [data]);

  const seen = useRef(new Set());
  const fresh = useMemo(() => {
    const rows = feed.data?.rows || [];
    const out = new Set();
    if (seen.current.size) rows.forEach((r) => { if (!seen.current.has(r.id)) out.add(r.id); });
    rows.forEach((r) => seen.current.add(r.id));
    return out;
  }, [feed.data]);

  if (loading && !data) return <Loading />;
  if (!data) return <Empty text="تعذّر تحميل المتابعة المباشرة" />;

  const { floor, orders, stages, kpis, hourly } = data;
  const tableName = Object.fromEntries(floor.map((t) => [t.id, t.name]));
  const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
  const orderOfTable = Object.fromEntries(orders.filter((o) => o.table_id).map((o) => [o.table_id, o]));
  const areas = [...new Set(floor.map((t) => t.area))];
  const shownFloor = floor.filter((t) => area === 'all' || t.area === area);
  const selOrder = sel?.kind === 'order' ? orderById[sel.id] : sel?.kind === 'table' ? orderOfTable[sel.id] : null;
  const selTable = sel?.kind === 'table' ? floor.find((t) => t.id === sel.id) : selOrder?.table_id ? floor.find((t) => t.id === selOrder.table_id) : null;
  const occ = kpis.tables ? Math.round((kpis.occupied / kpis.tables) * 100) : 0;
  const ago = Math.max(0, Math.round((Date.now() - updated) / 1000));

  return (
    <div className="lv">
      <header className="lv-head">
        <div className="lv-title">
          <span className="lv-live"><i aria-hidden /> مباشر</span>
          <h1>المتابعة المباشرة</h1>
          <small>كل ما يحدث في المطعم الآن · آخر تحديث منذ {ago} ث</small>
        </div>
        <div className="lv-alerts">
          {kpis.late > 0 && <button className="lv-alert err" onClick={() => setStage('new')}><Timer size={15} aria-hidden /> {kpis.late} متأخر</button>}
          {kpis.confirms > 0 && <button className="lv-alert warn" onClick={() => setStage('confirm')}><ShieldQuestion size={15} aria-hidden /> {kpis.confirms} بانتظار التأكيد</button>}
          {kpis.bills > 0 && <button className="lv-alert purple" onClick={() => setStage('bill')}><ReceiptText size={15} aria-hidden /> {kpis.bills} طلب حساب</button>}
          {kpis.qr_requests > 0 && <span className="lv-alert info"><QrCode size={15} aria-hidden /> {kpis.qr_requests} تطلب فتح QR</span>}
          {!kpis.late && !kpis.confirms && !kpis.bills && !kpis.qr_requests && <span className="lv-alert ok">✓ لا توجد تنبيهات</span>}
        </div>
      </header>

      {/* مؤشرات */}
      <section className="lv-kpis" aria-label="المؤشرات">
        <div className="lv-kpi main"><span>مبيعات اليوم</span><strong><AnimatedMoney value={kpis.sales_today} /></strong><small>{kpis.paid_today} طلب مدفوع · متوسط {money(kpis.avg_ticket)}</small></div>
        <div className="lv-kpi ring">
          <svg viewBox="0 0 44 44" role="img" aria-label={`إشغال ${occ}%`}><circle cx="22" cy="22" r="18" className="bg" /><circle cx="22" cy="22" r="18" className="fg" strokeDasharray={`${(occ / 100) * 113} 113`} /></svg>
          <div><span>الإشغال</span><strong><Num value={kpis.occupied} /> / {kpis.tables}</strong><small><Num value={occ} />%</small></div>
        </div>
        <div className="lv-kpi"><span>طلبات مفتوحة</span><strong><Num value={kpis.open_orders} /></strong><small><Users size={12} aria-hidden /> {kpis.guests_now} ضيف الآن</small></div>
        <div className="lv-kpi"><span>متوسط التحضير</span><strong>{kpis.avg_prep_min == null ? '—' : <><Num value={kpis.avg_prep_min} digits={1} /> د</>}</strong><small>الهدف أقل من {data.late_minutes} د</small></div>
        <div className="lv-kpi"><span>ملغاة اليوم</span><strong><Num value={kpis.cancelled_today} /></strong><small>طلب</small></div>
      </section>

      {/* مسار الطلبات */}
      <section className="lv-flow" aria-label="مسار الطلبات">
        {STAGES.map(([k, label, Icon], i) => {
          const list = orders.filter((o) => o.stage === k);
          return (
            <div key={k} className={`lv-stage st-${k} ${stage === k ? 'on' : ''} ${stage && stage !== k ? 'dim' : ''}`}>
              <button className="lv-node" onClick={() => setStage(stage === k ? null : k)} aria-pressed={stage === k} title={`إبراز طاولات «${label}»`}>
                <span className="lv-node-ico"><Icon size={20} aria-hidden /></span>
                <b><Num value={stages[k]} /></b>
                <span className="lv-node-label">{label}</span>
              </button>
              {i < STAGES.length - 1 && <span className="lv-link" aria-hidden />}
              <div className="lv-chips">
                {list.slice(0, 6).map((o) => {
                  const TI = TYPE_ICON[o.type] || ShoppingBag;
                  return (
                    <button key={o.id} className={`lv-chip ${o.late ? 'late' : ''} ${selOrder?.id === o.id ? 'sel' : ''} ${o.source === 'online' ? 'qr' : ''}`} onClick={() => setSel({ kind: 'order', id: o.id })} title={o.code}>
                      <TI size={12} aria-hidden /><span>{o.table_id ? tableName[o.table_id] : o.event_name ? `${o.event_name}${o.place ? ` · ${o.place}` : ''}` : ORDER_TYPES[o.type]}</span><em>{mmss(Date.now() - ts(o.created_at))}</em>
                    </button>
                  );
                })}
                {list.length > 6 && <span className="lv-more">+{list.length - 6}</span>}
              </div>
            </div>
          );
        })}
      </section>

      <div className="lv-grid">
        {/* خريطة الصالة */}
        <section className="lv-floor" aria-label="خريطة الصالة">
          <div className="lv-sec-head">
            <h2>خريطة الطاولات</h2>
            <div className="seg-pills">
              <button className={`fpill ${area === 'all' ? 'active' : ''}`} onClick={() => setArea('all')}>الكل</button>
              {areas.map((a) => <button key={a} className={`fpill ${area === a ? 'active' : ''}`} onClick={() => setArea(a)}>{a}</button>)}
            </div>
            {stage && <button className="fpill active" onClick={() => setStage(null)}>{STAGE_LABEL[stage]} <X size={12} aria-hidden /></button>}
          </div>
          <div className="lv-tables">
            {shownFloor.map((t) => {
              const o = orderOfTable[t.id];
              const st = o?.stage || (t.status === 'reserved' ? 'reserved' : 'free');
              const dim = stage && o?.stage !== stage;
              return (
                <button key={t.id} className={`lv-table s-${st} ${o?.late ? 'late' : ''} ${dim ? 'dim' : ''} ${selTable?.id === t.id ? 'sel' : ''}`} onClick={() => setSel({ kind: 'table', id: t.id })} aria-label={`${t.name}، ${o ? STAGE_LABEL[o.stage] : t.status === 'reserved' ? 'محجوزة' : 'فارغة'}`}>
                  <span className="lv-ring" aria-hidden />
                  <TableArt seats={t.seats} guests={o ? o.guests || 0 : 0} occupied={!!o} />
                  <strong>{t.name}</strong>
                  {o ? <><span className="lv-tot">{money(o.total)}</span><span className="lv-time"><Clock size={11} aria-hidden /> {mmss(Date.now() - ts(o.created_at))}</span></>
                    : <span className="lv-free">{t.status === 'reserved' ? t.reservation : t.qr_requested ? '🔔 تطلب فتح QR' : t.qr_open ? 'QR مفتوح' : 'متاحة'}</span>}
                  {o?.source === 'online' && <span className="lv-qr" title="طلب QR"><QrCode size={11} aria-hidden /></span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* التفاصيل + النشاط */}
        <aside className="lv-side">
          <section className={`lv-detail ${selTable || selOrder ? 'open' : ''}`} aria-live="polite">
            {!selTable && !selOrder ? (
              <div className="lv-hint"><Armchair size={28} aria-hidden /><p>اضغط على أي طاولة أو طلب لعرض تفاصيله اللحظية</p></div>
            ) : (
              <>
                <header>
                  <div><strong>{selTable?.name || (selOrder && (selOrder.event_name ? selOrder.event_name : ORDER_TYPES[selOrder.type]))}</strong>{selOrder && <small dir="ltr">{selOrder.code}</small>}</div>
                  <button className="icon-btn" onClick={() => setSel(null)} aria-label="إغلاق"><X size={18} /></button>
                </header>
                {selOrder ? (
                  <>
                    <div className={`lv-badge st-${selOrder.stage}`}>{STAGE_LABEL[selOrder.stage]}{selOrder.late ? ' · متأخر ⚠️' : ''}</div>
                    <dl className="lv-meta">
                      <div><dt>المبلغ</dt><dd>{money(selOrder.total)}</dd></div>
                      <div><dt>المدة</dt><dd>{mmss(Date.now() - ts(selOrder.created_at))}</dd></div>
                      {selOrder.guests ? <div><dt>الأشخاص</dt><dd>{selOrder.guests}</dd></div> : null}
                      <div><dt>النادل</dt><dd>{selOrder.waiter_name || '—'}</dd></div>
                      {selOrder.customer_name && <div><dt>العميل</dt><dd>{selOrder.customer_name}</dd></div>}
                      {selOrder.bill_method && <div><dt>الدفع</dt><dd>{({ cash: 'نقداً', wallet: 'محفظة', bank: 'بنك', jawwalpay: 'جوال بي' })[selOrder.bill_method]}</dd></div>}
                    </dl>
                    <div className="lv-prog" aria-label="تقدم الأصناف">
                      {['served', 'ready', 'preparing', 'new', 'draft'].map((k) => (selOrder.items[k] ? <span key={k} className={`p-${k}`} style={{ flexGrow: selOrder.items[k] }} title={`${selOrder.items[k]}`} /> : null))}
                    </div>
                    <ul className="lv-lines">
                      {selOrder.lines.map((l, i) => <li key={i}><b>{l.qty}×</b><span>{l.name}</span><em className={`ls-${l.status}`}>{({ pending: 'لم يُرسل', new: 'في المطبخ', preparing: 'تحضير', ready: 'جاهز', served: 'قُدّم' })[l.status]}</em></li>)}
                    </ul>
                    <div className="btn-row">
                      <button className="btn btn-primary btn-sm" onClick={() => navigate(`/pos/${selOrder.id}`)}><ExternalLink size={14} /> فتح الطلب</button>
                      <button className="btn btn-sm" onClick={() => navigate(`/cashier?order=${selOrder.id}`)}>الكاشير</button>
                      <button className="btn btn-sm" onClick={() => setTimeline(selOrder.id)}><History size={14} /> التسلسل</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted">{selTable.status === 'reserved' ? `محجوزة: ${selTable.reservation}` : `فارغة · ${selTable.seats} مقاعد · ${selTable.area}`}{selTable.qr_open ? ` · QR مفتوح${selTable.qr_opened_by_name ? ` (${selTable.qr_opened_by_name})` : ''}` : ''}</p>
                    <div className="btn-row">
                      <button className="btn btn-primary btn-sm" onClick={() => navigate(`/pos?type=dine_in&table=${selTable.id}`)}><Plus size={14} /> طلب جديد</button>
                      <button className="btn btn-sm" onClick={() => navigate(`/tables?table=${selTable.id}`)}><QrCode size={14} /> إدارة QR</button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          <section className="lv-feed" aria-label="آخر الحركات">
            <div className="lv-sec-head"><h2>آخر الحركات</h2><button className="link-btn small" onClick={() => navigate('/activity')}>السجل الكامل</button></div>
            {!feed.data?.rows?.length ? <p className="muted small">لا توجد حركات بعد</p> : (
              <ol>
                {feed.data.rows.map((a) => {
                  const [Icon, text] = describe(a, money);
                  return (
                    <li key={a.id} className={`lv-ev act-${tone(a.action)} ${fresh.has(a.id) ? 'new' : ''}`} onClick={() => a.order_code && a.entity_id && setSel({ kind: 'order', id: a.entity_id })}>
                      <span className="lv-ev-ico" aria-hidden><Icon size={14} /></span>
                      <span className="lv-ev-text">{text}<small>{a.user_name || (/^qr\./.test(a.action) ? 'الزبون (QR)' : 'النظام')}</small></span>
                      <time dir="ltr">{String(a.created_at).slice(11, 16)}</time>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>

      {/* رسوم بيانية */}
      <section className="lv-charts">
        <Hourly hourly={hourly} money={money} />
        <Donut title="طلبات اليوم حسب النوع" rows={data.by_type.map((x) => ({ k: x.type, label: ORDER_TYPES[x.type] || x.type, v: x.c }))} colors={{ dine_in: 'var(--primary)', takeaway: 'var(--accent)', delivery: 'var(--info)' }} />
        <Donut title="مصدر الطلب" rows={data.by_source.map((x) => ({ k: x.source, label: x.source === 'online' ? 'عبر QR' : 'الموظفون', v: x.c }))} colors={{ online: 'var(--warn)', staff: 'var(--primary)' }} />
      </section>

      {!orders.length && !kpis.paid_today && <p className="muted small lv-empty"><TriangleAlert size={14} aria-hidden /> لا توجد حركة اليوم بعد، ستظهر هنا لحظة حدوثها.</p>}
      {timeline && <OrderTimeline orderId={timeline} onClose={() => setTimeline(null)} />}
    </div>
  );
}

/** مبيعات اليوم بالساعة */
function Hourly({ hourly, money }) {
  const nowH = new Date().getHours();
  const act = hourly.findIndex((h) => h.orders > 0);
  const from = act >= 0 ? Math.max(0, Math.min(8, act - 1)) : 8;
  const hrs = hourly.slice(from, Math.max(nowH, 20) + 1);
  const max = Math.max(1, ...hrs.map((h) => h.sales));
  const [hv, setHv] = useState(null);
  return (
    <div className="lv-chart">
      <div className="lv-sec-head"><h2>المبيعات بالساعة</h2><small className="muted">{hv ? `${hv.h}:00 · ${money(hv.sales)} · ${hv.orders} طلب` : 'مرّر على العمود'}</small></div>
      <div className="lv-bars" onMouseLeave={() => setHv(null)}>
        {hrs.map((h) => (
          <button key={h.h} className={`lv-bar ${h.h === nowH ? 'now' : ''}`} onMouseEnter={() => setHv(h)} onFocus={() => setHv(h)} aria-label={`${h.h}:00 ${money(h.sales)}`}>
            <span style={{ height: `${Math.max(3, (h.sales / max) * 100)}%` }} />
            <small>{h.h}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** حلقة نسب */
function Donut({ title, rows, colors }) {
  const total = rows.reduce((a, r) => a + r.v, 0);
  let acc = 0;
  return (
    <div className="lv-chart">
      <div className="lv-sec-head"><h2>{title}</h2></div>
      {!total ? <p className="muted small">لا بيانات بعد</p> : (
        <div className="lv-donut">
          <svg viewBox="0 0 42 42" role="img" aria-label={title}>
            <circle cx="21" cy="21" r="15.9" className="bg" />
            {rows.map((r) => { const d = (r.v / total) * 100; const el = <circle key={r.k} cx="21" cy="21" r="15.9" className="seg" stroke={colors[r.k] || 'var(--muted)'} strokeDasharray={`${d} ${100 - d}`} strokeDashoffset={25 - acc} />; acc += d; return el; })}
            <text x="21" y="23.5" textAnchor="middle" className="t">{total}</text>
          </svg>
          <ul>{rows.map((r) => <li key={r.k}><i style={{ background: colors[r.k] || 'var(--muted)' }} /> {r.label} <b>{r.v}</b></li>)}</ul>
        </div>
      )}
    </div>
  );
}
