import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShoppingBag, Bike, Clock, CalendarDays, BellRing, Sparkles, LayoutGrid, Armchair, Banknote, QrCode, X, UserRound } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useMoney, useNow, has, minutesSince, Loading, Empty, PageHead, useToast } from '../lib.jsx';
import { TableArt, AnimatedMoney } from '../components/TableHero.jsx';

const FILTERS = [
  ['all', 'الكل'],
  ['free', 'فارغة'],
  ['occupied', 'مشغولة'],
  ['reserved', 'محجوزة'],
  ['ready', 'جاهز للتقديم'],
];
const STATUS_LABEL = { free: 'متاحة', occupied: 'مشغولة', reserved: 'محجوزة' };

export default function Tables() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const focusId = Number(sp.get('table')) || 0;
  const money = useMoney();
  const { user } = useApp();
  const canCreate = has(user, 'pos.create');
  const { data, loading, reload } = useData('/tables', ['tables', 'orders']);
  const toast = useToast();
  const canQr = has(user, 'pos.create', 'payments.collect', 'tables.view');
  // الوصول من إشعار: تمرير وإبراز الطاولة المقصودة
  useEffect(() => {
    if (!focusId || !data) return undefined;
    const el = document.getElementById(`tbl-${focusId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return undefined;
  }, [focusId, !!data]); // eslint-disable-line
  const clearFocus = () => setSp({}, { replace: true });
  const toggleQr = async (t) => {
    try {
      await api(`/tables/${t.id}/qr/${t.qr_open ? 'close' : 'open'}`, { method: 'POST' });
      toast(t.qr_open ? `أُغلق طلب QR على ${t.name}` : `${t.name} مفتوحة لطلب الزبون عبر QR`);
      if (focusId === t.id) clearFocus();
      reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const [filter, setFilter] = useState('all');
  const [area, setArea] = useState('all');
  useNow();

  const stats = useMemo(() => {
    const s = { free: 0, occupied: 0, reserved: 0, ready: 0, guests: 0, total: 0 };
    (data || []).forEach((t) => {
      s[t.status]++;
      if (t.ready_items > 0) s.ready++;
      if (t.order_id) { s.guests += t.guests || 0; s.total += t.order_total || 0; }
    });
    return s;
  }, [data]);

  if (loading) return <Loading />;
  if (!data?.length) return <Empty text="لا توجد طاولات، أضفها من الإعدادات" />;

  const areas = [...new Set(data.map((t) => t.area))];
  const count = (k) => (k === 'all' ? data.length : k === 'ready' ? stats.ready : stats[k]);
  const shown = data.filter((t) => (area === 'all' || t.area === area)
    && (filter === 'all' || (filter === 'ready' ? t.ready_items > 0 : t.status === filter)));
  const shownAreas = areas.filter((a) => shown.some((t) => t.area === a));
  const occ = Math.round((stats.occupied / data.length) * 100);

  return (
    <div className="floor">
      <PageHead title="الطاولات">
        {canCreate && <button className="btn" onClick={() => navigate('/pos?type=takeaway')}><ShoppingBag size={17} /> طلب تيك وي</button>}
        {canCreate && <button className="btn" onClick={() => navigate('/pos?type=delivery')}><Bike size={17} /> طلب توصيل</button>}
      </PageHead>

      {focusId > 0 && (() => {
        const ft = data.find((x) => x.id === focusId);
        if (!ft) return null;
        const mins = ft.qr_request_at ? Math.max(0, minutesSince(ft.qr_request_at)) : null;
        return (
          <div className={`qr-focus ${ft.qr_requested ? 'req' : ''}`} role="status">
            <span className="qf-ico" aria-hidden><QrCode size={20} /></span>
            <div className="qf-text">
              {ft.order_id ? <><strong>{ft.name} عليها طلب مفتوح</strong><small>{ft.pending_confirm ? 'طلب QR بانتظار تأكيدك' : 'يمكنك فتح الطلب ومتابعته'}</small></>
                : ft.qr_open ? <><strong>{ft.name} مفتوحة لطلب QR</strong><small><UserRound size={12} aria-hidden /> فتحها {ft.qr_opened_by_name || '—'}</small></>
                  : ft.qr_requested ? <><strong>{ft.name} تطلب فتح الطلب بالـ QR</strong><small>منذ {mins} د · اضغط استلام لتتولى الطلب وتُفتح الطاولة باسمك</small></>
                    : <><strong>{ft.name}</strong><small>لا يوجد طلب فتح حالياً</small></>}
            </div>
            {ft.order_id ? <button className="btn btn-primary btn-sm" onClick={() => navigate(`/pos/${ft.order_id}`)}>فتح الطلب</button>
              : !ft.qr_open && canQr ? <button className="btn btn-primary btn-sm" onClick={() => toggleQr(ft)}><QrCode size={15} /> استلام وفتح الطاولة</button> : null}
            <button className="icon-btn" onClick={clearFocus} aria-label="إغلاق"><X size={18} /></button>
          </div>
        );
      })()}

      <div className="floor-stats">
        <div className="fstat fstat-main">
          <div className="fring" style={{ '--p': occ }} role="img" aria-label={`إشغال ${occ}%`}><b>{occ}%</b></div>
          <div><span>الإشغال</span><strong>{stats.occupied} من {data.length}</strong></div>
        </div>
        <div className="fstat"><Armchair size={18} aria-hidden /><div><span>الضيوف الآن</span><strong>{stats.guests}</strong></div></div>
        <div className="fstat"><Banknote size={18} aria-hidden /><div><span>طلبات مفتوحة</span><strong><AnimatedMoney value={stats.total} /></strong></div></div>
        <div className={`fstat ${stats.ready ? 'fstat-alert' : ''}`}><BellRing size={18} aria-hidden /><div><span>جاهز للتقديم</span><strong>{stats.ready}</strong></div></div>
      </div>

      <div className="floor-filters">
        <div className="seg-pills" role="tablist" aria-label="الحالة">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`fpill fp-${k} ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
              {k !== 'all' && <i className={`dot ${k === 'ready' ? 'ready' : k}`} />} {label} <small>{count(k)}</small>
            </button>
          ))}
        </div>
        {areas.length > 1 && (
          <div className="seg-pills" role="tablist" aria-label="المنطقة">
            <button role="tab" aria-selected={area === 'all'} className={`fpill ${area === 'all' ? 'active' : ''}`} onClick={() => setArea('all')}><LayoutGrid size={13} aria-hidden /> كل المناطق</button>
            {areas.map((a) => <button key={a} role="tab" aria-selected={area === a} className={`fpill ${area === a ? 'active' : ''}`} onClick={() => setArea(a)}>{a}</button>)}
          </div>
        )}
      </div>

      {!shown.length && <Empty text="لا توجد طاولات بهذه التصفية" />}
      {shownAreas.map((a) => (
        <section key={a} className="area">
          <h2 className="area-title">{a} <small>{shown.filter((t) => t.area === a).length}</small></h2>
          <div className="tables-grid">
            {shown.filter((t) => t.area === a).map((t, i) => (
              <div key={t.id} id={`tbl-${t.id}`} className={`t-cell ${focusId === t.id ? 't-focus' : ''} ${t.locked ? 'locked' : ''}`}>
              <button className={`table-card t-${t.status} ${t.ready_items > 0 ? 't-ready' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                onClick={() => !t.locked && navigate(t.order_id ? `/pos/${t.order_id}` : `/pos?type=dine_in&table=${t.id}`)} aria-disabled={t.locked || undefined}
                aria-label={`${t.name}، ${STATUS_LABEL[t.status]}`}>
                <span className={`t-state s-${t.status}`}><i className="dot" /> {STATUS_LABEL[t.status]}</span>
                {t.pending_confirm ? <span className="t-confirm"><QrCode size={12} aria-hidden /> بانتظار تأكيدك</span> : null}
                {t.ready_items > 0 && <span className="t-readybadge"><BellRing size={12} aria-hidden /> جاهز {t.ready_items}</span>}
                <div className="t-art"><TableArt seats={t.seats} guests={t.order_id ? (t.guests || 0) : 0} occupied={!!t.order_id} /></div>
                <div className="t-name">{t.name}</div>
                {t.locked ? (
                  <div className="t-owner"><UserRound size={13} aria-hidden /> مع {t.waiter_name || 'نادل آخر'}</div>
                ) : t.order_id ? (
                  <>
                    <div className="t-total">{money(t.order_total)}</div>
                    <div className="t-time"><Clock size={13} aria-hidden /> {minutesSince(t.opened_at)} د · <bdi dir="ltr">{t.order_code}</bdi></div>
                  </>
                ) : t.reservation ? (
                  <div className="t-res"><CalendarDays size={13} aria-hidden /> {t.reservation}</div>
                ) : (
                  <div className="t-avail"><Sparkles size={13} aria-hidden /> {t.seats} مقاعد · متاحة</div>
                )}
              </button>
              {canQr && !t.order_id && !t.locked && !t.reservation && (
                <button className={`t-qr ${t.qr_open ? 'on' : ''} ${t.qr_requested ? 'req' : ''}`} onClick={() => toggleQr(t)} aria-pressed={!!t.qr_open} title={t.qr_open ? 'إغلاق الطلب بالـ QR' : 'فتح الطاولة لطلب الزبون بالـ QR'}>
                  <QrCode size={14} aria-hidden /> {t.qr_open ? `QR مفتوح${t.qr_opened_by_name ? ` · ${t.qr_opened_by_name}` : ''}` : t.qr_requested ? 'الزبون يطلب الفتح — افتح' : 'فتح للـ QR'}
                </button>
              )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
