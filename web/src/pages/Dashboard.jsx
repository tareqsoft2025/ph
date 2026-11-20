import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Radio, Banknote, TrendingUp, TrendingDown, Receipt, Armchair, ChefHat, TriangleAlert, CircleCheck, Fingerprint, CalendarOff, FileWarning, Package, ArrowLeftRight,
  BellRing, Clock, Flame, HandPlatter, QrCode, Trophy, Users, ChevronLeft, Wallet, LockOpen, Lock,
} from 'lucide-react';
import { useApp, useData, useMoney, has, Loading, Empty, todayStr, ORDER_TYPES, PAY_METHODS } from '../lib.jsx';
import { AnimatedMoney, useTween } from '../components/TableHero.jsx';
import { Spark, Ring, Columns, Donut } from '../components/charts.jsx';

const p2 = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d); };
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'مساء الخير' : h < 12 ? 'صباح الخير' : h < 18 ? 'نهارك سعيد' : 'مساء الخير'; };

function Num({ value, suffix = '' }) {
  const v = useTween(Number(value) || 0);
  return <>{Math.round(v).toLocaleString('en-US')}{suffix}</>;
}

function Delta({ value, label }) {
  if (value == null) return <span className="dsh-delta flat">{label}</span>;
  const up = value >= 0;
  const I = up ? TrendingUp : TrendingDown;
  return <span className={`dsh-delta ${up ? 'up' : 'down'}`}><I size={13} aria-hidden /> {up ? '+' : ''}{value}% <small>{label}</small></span>;
}

/** لوحة التحكم: نظرة تنفيذية على اليوم + نبض المطعم الآن + ما يحتاج انتباهاً */
export default function Dashboard() {
  const money = useMoney();
  const { user } = useApp();
  const today = todayStr();
  const rep = useData(`/reports/summary?from=${today}&to=${today}`, ['orders']);
  const yest = useData(`/reports/summary?from=${ago(1)}&to=${ago(1)}`, ['orders']);
  const wk = useData(`/reports/summary?from=${ago(6)}&to=${today}`, ['orders']);
  const live = useData('/live', ['orders', 'tables', 'kitchen', 'shift']);
  const shift = useData('/shifts/current', ['shift']);
  const att = useData(has(user, 'hr.attendance') ? '/attendance' : null, ['attendance', 'hr']);
  const hr = useData(has(user, 'hr.employees') ? '/hr/alerts' : null, ['hr']);
  const trf = useData(has(user, 'transfers.audit') ? '/transfers?status=open' : null, ['transfers']);
  const [mix, setMix] = useState('category');

  const d = rep.data;
  const t = d?.totals || {};
  const k = live.data?.kpis || {};
  const stages = live.data?.stages || {};

  const week = useMemo(() => {
    const by = Object.fromEntries((wk.data?.byDay || []).map((r) => [r.day, r]));
    return Array.from({ length: 7 }, (_, i) => {
      const day = ago(6 - i);
      const r = by[day];
      return { key: day, value: r?.total || 0, label: new Date(`${day}T00:00`).toLocaleDateString('ar', { weekday: 'short' }), sub: `${r?.orders || 0} طلب`, current: day === today };
    });
  }, [wk.data, today]);
  const weekAvgTicket = wk.data?.totals?.avg_ticket || 0;
  const hourly = useMemo(() => {
    const rows = d?.byHour || [];
    if (!rows.length) return [];
    const lo = Math.min(...rows.map((r) => r.hour)); const hi = Math.max(...rows.map((r) => r.hour), new Date().getHours());
    const by = Object.fromEntries(rows.map((r) => [r.hour, r.total]));
    let run = 0;   // تراكمي: يوضح كيف تنمو مبيعات اليوم ساعة بساعة
    return Array.from({ length: hi - lo + 1 }, (_, i) => { run += by[lo + i] || 0; return run; });
  }, [d]);
  const peak = useMemo(() => (d?.byHour || []).reduce((m, r) => (r.total > (m?.total || 0) ? r : m), null), [d]);

  const mixRows = useMemo(() => {
    if (!d) return [];
    if (mix === 'category') return d.byCategory.map((r) => ({ label: r.name, value: r.total }));
    if (mix === 'payment') return d.byPayment.map((r) => ({ label: PAY_METHODS[r.method] || r.method, value: r.total }));
    return d.byType.map((r) => ({ label: ORDER_TYPES[r.type] || r.type, value: r.total }));
  }, [d, mix]);

  if (rep.loading) return <Loading />;

  const sales = t.sales || 0;
  const ySales = yest.data?.totals?.sales || 0;
  const vsYesterday = ySales > 0 ? Math.min(100, Math.round((sales / ySales) * 100)) : null;
  const margin = t.net_sales > 0 ? Math.round((t.gross_profit / t.net_sales) * 100) : 0;
  const occ = k.tables ? Math.round((k.occupied / k.tables) * 100) : 0;
  const s = shift.data;
  const lowCount = d?.lowStock?.length || 0;

  // ما يحتاج انتباهاً الآن
  const attention = [
    k.late > 0 && { icon: Clock, tone: 'err', text: 'طلبات متأخرة في المطبخ', n: k.late, to: '/live' },
    k.bills > 0 && { icon: Receipt, tone: 'warn', text: 'زبائن طلبوا الحساب', n: k.bills, to: '/cashier' },
    k.confirms > 0 && { icon: BellRing, tone: 'warn', text: 'طلبات QR بانتظار التأكيد', n: k.confirms, to: '/tables' },
    k.qr_requests > 0 && { icon: QrCode, tone: 'info', text: 'طاولات تطلب فتح الطلب', n: k.qr_requests, to: '/tables' },
    trf.data?.by_status && { icon: ArrowLeftRight, tone: 'warn', text: 'تحويلات بانتظار التدقيق', n: (trf.data.by_status.find((x) => x.k === 'pending')?.n || 0) + (trf.data.by_status.find((x) => x.k === 'mismatch')?.n || 0), to: '/transfers' },
    lowCount > 0 && { icon: Package, tone: 'warn', text: 'مواد قاربت على النفاد', n: lowCount, to: '/inventory' },
    hr.data?.pending_leaves > 0 && { icon: CalendarOff, tone: 'info', text: 'طلبات إجازة بانتظار الاعتماد', n: hr.data.pending_leaves, to: '/leaves' },
    hr.data && hr.data.docs.length + hr.data.contracts.length > 0 && { icon: FileWarning, tone: 'info', text: 'مستندات وعقود تحتاج تجديداً', n: hr.data.docs.length + hr.data.contracts.length, to: '/employees' },
  ].filter((x) => x && x.n > 0);

  return (
    <div className="dsh">
      {/* ───── الترحيب والوردية ───── */}
      <header className="dsh-hero">
        <div className="dsh-hero-txt">
          <span className="dsh-date">{new Date().toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>{greet()}، {String(user?.name || '').split(' ')[0]}</h1>
          <p>{sales > 0 ? <>حتى الآن <b>{money(sales)}</b> من <b>{t.orders}</b> طلب مدفوع{vsYesterday != null ? <> — أي <b>{vsYesterday}%</b> من مبيعات أمس</> : null}.</> : 'لم تُسجَّل مبيعات اليوم بعد. أول طلب سيظهر هنا فور دفعه.'}</p>
          <div className="dsh-chips">
            <span className={`dsh-chip ${s ? 'ok' : 'warn'}`}>{s ? <LockOpen size={14} aria-hidden /> : <Lock size={14} aria-hidden />} {s ? `الوردية مفتوحة · ${s.user_name || ''}` : 'لا توجد وردية مفتوحة'}</span>
            {k.guests_now > 0 && <span className="dsh-chip"><Users size={14} aria-hidden /> {k.guests_now} ضيف الآن</span>}
            {k.avg_prep_min != null && <span className="dsh-chip"><ChefHat size={14} aria-hidden /> متوسط التحضير {Math.round(k.avg_prep_min)} د</span>}
            {!s && <Link className="dsh-chip link" to="/shifts">افتح وردية</Link>}
          </div>
        </div>
        <div className="dsh-hero-act">
          <Link className="btn btn-primary btn-lg" to="/tables"><Plus size={18} /> طلب جديد</Link>
          <Link className="btn btn-lg dsh-ghost" to="/live"><Radio size={18} /> المتابعة المباشرة</Link>
          {has(user, 'payments.collect') && <Link className="btn btn-lg dsh-ghost" to="/cashier"><Banknote size={18} /> الكاشير</Link>}
        </div>
      </header>

      {/* ───── المؤشرات ───── */}
      <section className="dsh-kpis" aria-label="مؤشرات اليوم">
        <article className="dsh-kpi main">
          <header><span>مبيعات اليوم</span><Delta value={pct(sales, ySales)} label="عن أمس الكامل" /></header>
          <strong className="dsh-big"><AnimatedMoney value={sales} /></strong>
          <Spark values={hourly} height={62} />
          <footer>
            {ySales > 0 && <div className="dsh-prog" title="نسبة ما بلغته مبيعات اليوم من مبيعات أمس"><i style={{ width: `${vsYesterday}%` }} /></div>}
            <small>{ySales > 0 ? `أمس ${money(ySales)}` : 'لا مبيعات أمس للمقارنة'}{peak ? ` · ذروة اليوم ${peak.hour}:00` : ''}</small>
          </footer>
        </article>

        <article className="dsh-kpi">
          <header><span>الطلبات</span><Receipt size={16} aria-hidden /></header>
          <strong className="dsh-num"><Num value={t.orders} /></strong>
          <ul className="dsh-mini"><li><b><Num value={k.open_orders} /></b> مفتوحة الآن</li><li><b><Num value={t.cancelled} /></b> ملغاة</li></ul>
          {d?.byType?.length > 0 && <div className="dsh-types">{d.byType.map((x) => <span key={x.type}>{ORDER_TYPES[x.type] || x.type} <b>{x.orders}</b></span>)}</div>}
        </article>

        <article className="dsh-kpi">
          <header><span>متوسط الفاتورة</span></header>
          <strong className="dsh-num"><AnimatedMoney value={t.avg_ticket || 0} /></strong>
          <Delta value={pct(t.avg_ticket || 0, weekAvgTicket)} label="عن متوسط الأسبوع" />
          <ul className="dsh-mini"><li>متوسط الأسبوع <b>{money(weekAvgTicket)}</b></li></ul>
        </article>

        <article className="dsh-kpi ring">
          <div>
            <header><span>هامش الربح</span></header>
            <strong className="dsh-num"><AnimatedMoney value={t.gross_profit || 0} /></strong>
            <ul className="dsh-mini"><li>التكلفة <b>{money(t.cogs || 0)}</b></li>{t.waste > 0 && <li>تالف <b>{money(t.waste)}</b></li>}</ul>
          </div>
          <Ring value={margin} tone={margin >= 50 ? 'var(--ok)' : margin >= 30 ? '#d98a3d' : 'var(--err)'}><b>{margin}%</b></Ring>
        </article>
      </section>

      <div className="dsh-grid">
        {/* ───── التحليل ───── */}
        <div className="dsh-col">
          <section className="dsh-card">
            <header><h3>المبيعات آخر 7 أيام</h3><span className="muted small">إجمالي {money(wk.data?.totals?.sales || 0)} · {wk.data?.totals?.orders || 0} طلب</span></header>
            <Columns rows={week} fmt={(v) => money(v)} />
          </section>

          <div className="dsh-two">
            <section className="dsh-card">
              <header>
                <h3>تركيبة المبيعات</h3>
                <div className="seg dsh-seg" role="tablist">{[['category', 'الفئات'], ['payment', 'الدفع'], ['type', 'النوع']].map(([id, l]) => <button key={id} role="tab" aria-selected={mix === id} className={mix === id ? 'active' : ''} onClick={() => setMix(id)}>{l}</button>)}</div>
              </header>
              <Donut rows={mixRows} fmt={(v) => money(v)} />
            </section>

            <section className="dsh-card">
              <header><h3><Trophy size={16} aria-hidden /> الأكثر مبيعاً اليوم</h3></header>
              {d?.topItems?.length ? (
                <ol className="dsh-top">
                  {d.topItems.slice(0, 6).map((i, n) => (
                    <li key={i.name}><span className="rk">{n + 1}</span><span className="nm">{i.name}</span><span className="tr"><i style={{ width: `${(100 * i.qty) / d.topItems[0].qty}%` }} /></span><b>{i.qty}</b></li>
                  ))}
                </ol>
              ) : <Empty text="لا مبيعات بعد" />}
            </section>
          </div>
        </div>

        {/* ───── الآن ───── */}
        <aside className="dsh-col">
          <section className="dsh-card now">
            <header><h3><span className="live-dot" aria-hidden /> الآن في المطعم</h3><Link to="/live" className="dsh-more">التفاصيل <ChevronLeft size={14} /></Link></header>
            <div className="dsh-occ">
              <Ring value={occ} size={92} stroke={10} tone="var(--primary)"><b>{k.occupied ?? 0}</b><small>من {k.tables ?? 0}</small></Ring>
              <div>
                <strong>إشغال الطاولات {occ}%</strong>
                <div className="dsh-floor" aria-label="خريطة الطاولات">
                  {(live.data?.floor || []).map((f) => <i key={f.id} className={`fl-${f.status}`} title={`${f.name} · ${{ occupied: 'مشغولة', free: 'فارغة', reserved: 'محجوزة' }[f.status] || f.status}`} />)}
                </div>
              </div>
            </div>
            <div className="dsh-pipe" aria-label="حالة المطبخ">
              <Link to="/kitchen" className="pp new"><Flame size={15} aria-hidden /><b>{stages.new || 0}</b><span>جديدة</span></Link>
              <Link to="/kitchen" className="pp prep"><ChefHat size={15} aria-hidden /><b>{stages.preparing || 0}</b><span>قيد التحضير</span></Link>
              <Link to="/kitchen" className="pp ready"><HandPlatter size={15} aria-hidden /><b>{stages.ready || 0}</b><span>جاهزة</span></Link>
            </div>
          </section>

          <section className="dsh-card">
            <header><h3><TriangleAlert size={16} aria-hidden /> يحتاج انتباهك</h3>{attention.length > 0 && <span className="badge badge-warn">{attention.length}</span>}</header>
            {attention.length ? (
              <ul className="dsh-att">
                {attention.map((a) => { const I = a.icon; return <li key={a.text}><Link to={a.to} className={`t-${a.tone}`}><span className="ic"><I size={16} aria-hidden /></span><span className="tx">{a.text}</span><b>{a.n}</b><ChevronLeft size={15} aria-hidden /></Link></li>; })}
              </ul>
            ) : <div className="dsh-ok"><CircleCheck size={22} aria-hidden /><strong>كل شيء على ما يرام</strong><small>لا توجد تنبيهات الآن</small></div>}
          </section>

          {att.data && (
            <section className="dsh-card">
              <header><h3><Fingerprint size={16} aria-hidden /> الفريق اليوم</h3><Link to="/attendance" className="dsh-more">الحضور <ChevronLeft size={14} /></Link></header>
              <div className="dsh-team">
                <Ring value={att.data.rows.length ? (att.data.totals.in / att.data.rows.length) * 100 : 0} size={76} stroke={9} tone="var(--ok)"><b>{att.data.totals.in}</b><small>/{att.data.rows.length}</small></Ring>
                <ul>
                  <li><span>حاضرون</span><b>{att.data.totals.in}</b></li>
                  <li><span>متأخرون</span><b className={att.data.totals.late ? 'text-warn' : ''}>{att.data.totals.late}</b></li>
                  <li><span>في إجازة</span><b>{att.data.totals.leave}</b></li>
                </ul>
              </div>
            </section>
          )}

          {d?.byStaff?.length > 0 && (
            <section className="dsh-card">
              <header><h3><Wallet size={16} aria-hidden /> مبيعات الموظفين</h3></header>
              <ol className="dsh-top staff">
                {d.byStaff.slice(0, 4).map((i, n) => <li key={i.name}><span className="rk">{n + 1}</span><span className="nm">{i.name}</span><span className="tr"><i style={{ width: `${(100 * i.total) / d.byStaff[0].total}%` }} /></span><b>{money(i.total)}</b></li>)}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
