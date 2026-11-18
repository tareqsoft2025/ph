import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Plus, QrCode, Printer, FileText, Pencil, Pause, Play, Trash2, ListChecks, Utensils, BadgePercent, CalendarClock, Users, Banknote, Search, RefreshCw, CircleCheckBig,
} from 'lucide-react';
import { api, isNative, getServerUrl } from '../api.js';
import { useApp, useData, useAction, useMoney, has, Modal, Field, Empty, Loading, PageHead, PAY_METHODS } from '../lib.jsx';
import Qr from '../components/Qr.jsx';

const STATE = { open: ['جارية', 'ok'], not_started: ['قادمة', 'info'], ended: ['منتهية', ''], paused: ['موقوفة', 'warn'] };
const MODE = { selected: 'قائمة محددة', full: 'قائمة المطعم كاملة', cap: 'سقف للسعر' };
const pad = (n) => String(n).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const when = (s) => String(s || '').slice(0, 16).replace('T', ' ');
const eventUrl = (token) => `${isNative ? `${getServerUrl()}/` : `${window.location.origin}${window.location.pathname}`}#/e/${token}`;

/** فعاليات المؤسسات: مؤسسة تستأجر المكان ويطلب موظفوها من قائمة محددة عبر QR خاص */
export default function Events() {
  const money = useMoney();
  const { user } = useApp();
  const { data, loading, reload } = useData('/events', ['orders'], []);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const [poster, setPoster] = useState(null);
  const [run] = useAction();
  const [tab, setTab] = useState('active');

  const rows = useMemo(() => (data || []).filter((e) => (tab === 'active' ? e.state === 'open' || e.state === 'not_started' || e.state === 'paused' : e.state === 'ended')), [data, tab]);
  const toggle = async (e) => { if (await run(() => api(`/events/${e.id}/active`, { method: 'POST', body: { active: !e.active } }), e.active ? 'تم إيقاف الطلب' : 'تم تفعيل الطلب')) reload(); };

  return (
    <div className="evs">
      <PageHead title="فعاليات المؤسسات" sub="مؤسسة استأجرت المكان؟ أنشئ لها QR خاصاً وحدّد قائمتها وسقفها">
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={17} /> فعالية جديدة</button>
      </PageHead>
      <div className="seg" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>الحالية والقادمة</button>
        <button role="tab" aria-selected={tab === 'past'} className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>المنتهية</button>
      </div>
      {loading && !data ? <Loading /> : !rows.length ? <Empty icon={Building2} text={tab === 'active' ? 'لا توجد فعاليات حالية. أنشئ فعالية جديدة لمؤسسة استأجرت المكان.' : 'لا توجد فعاليات منتهية'} /> : (
        <div className="ev-grid">
          {rows.map((e) => {
            const [sl, sc] = STATE[e.state] || ['', ''];
            return (
              <article key={e.id} className={`ev-card ev-${e.state}`}>
                <header>
                  <span className="ev-ico" aria-hidden><Building2 size={22} /></span>
                  <div><h3>{e.name}</h3>{e.contact_name && <small>{e.contact_name}{e.contact_phone ? ` · ${e.contact_phone}` : ''}</small>}</div>
                  <span className={`badge ${sc ? `badge-${sc}` : ''}`}>{sl}</span>
                </header>
                <p className="ev-time"><CalendarClock size={14} aria-hidden /> {when(e.starts_at)} ← {when(e.ends_at)}</p>
                <div className="ev-tags">
                  <span><Utensils size={13} aria-hidden /> {MODE[e.menu_mode]}{e.menu_mode === 'selected' ? ` (${e.item_count} صنف)` : e.menu_mode === 'cap' ? ` ≤ ${money(e.price_cap)}` : ''}</span>
                  {e.order_cap && <span><BadgePercent size={13} aria-hidden /> سقف الطلب {money(e.order_cap)}</span>}
                  <span><Banknote size={13} aria-hidden /> {e.billing === 'institution' ? 'الحساب على المؤسسة' : 'كل موظف يدفع'}</span>
                  {e.needs_approval ? <span><CircleCheckBig size={13} aria-hidden /> يحتاج اعتماداً</span> : null}
                </div>
                <dl className="ev-stats">
                  <div><dt>الطلبات</dt><dd>{e.orders}</dd></div>
                  <div><dt>مفتوحة</dt><dd>{e.open_orders}</dd></div>
                  <div><dt>الإجمالي</dt><dd>{money(e.total)}</dd></div>
                </dl>
                <footer>
                  <button className="btn btn-primary btn-sm" onClick={() => setPoster(e)}><QrCode size={15} /> QR وطباعة</button>
                  <button className="btn btn-sm" onClick={() => setView(e.id)}><FileText size={15} /> كشف الحساب</button>
                  <button className="btn btn-sm" onClick={() => setEdit(e)}><Pencil size={15} /> تعديل</button>
                  {e.state !== 'ended' && <button className="btn btn-sm btn-ghost" onClick={() => toggle(e)}>{e.active ? <><Pause size={15} /> إيقاف</> : <><Play size={15} /> تفعيل</>}</button>}
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {edit && <EventForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {view && <EventDetail id={view} canSettle={has(user, 'payments.collect')} onClose={() => { setView(null); reload(); }} />}
      {poster && <Poster ev={poster} onClose={() => setPoster(null)} onRotate={reload} />}
    </div>
  );
}

function EventForm({ initial, onClose, onSaved }) {
  const money = useMoney();
  const menu = useData('/menu', ['menu'], []);
  const full = useData(initial.id ? `/events/${initial.id}` : null, [], [initial.id]);
  const [run, busy] = useAction();
  const now = new Date();
  const [f, setF] = useState(() => ({
    name: '', contact_name: '', contact_phone: '', starts_at: local(now), ends_at: local(new Date(now.getTime() + 4 * 36e5)),
    menu_mode: 'selected', price_cap: '', order_cap: '', billing: 'institution', needs_approval: false, places: '', notes: '', welcome_message: '', support_phone: '', support_chat: true, item_ids: [], active: true, ...initial,
    ...(initial.id ? { starts_at: String(initial.starts_at).slice(0, 16).replace(' ', 'T'), ends_at: String(initial.ends_at).slice(0, 16).replace(' ', 'T'), places: (initial.places || []).join('\n'), needs_approval: !!initial.needs_approval, support_chat: initial.support_chat !== 0 && initial.support_chat !== false, welcome_message: initial.welcome_message || '', support_phone: initial.support_phone || '', price_cap: initial.price_cap || '', order_cap: initial.order_cap || '' } : {}),
  }));
  useEffect(() => { if (initial.id && full.data) setF((x) => ({ ...x, item_ids: full.data.item_ids })); }, [full.data]); // eslint-disable-line
  const [q, setQ] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const sel = new Set(f.item_ids);
  const toggleItem = (id) => setF({ ...f, item_ids: sel.has(id) ? f.item_ids.filter((x) => x !== id) : [...f.item_ids, id] });
  const toggleCat = (ids, on) => setF({ ...f, item_ids: on ? [...new Set([...f.item_ids, ...ids])] : f.item_ids.filter((x) => !ids.includes(x)) });
  const cats = (menu.data?.categories || []).map((c) => ({ ...c, items: (menu.data.items || []).filter((i) => i.category_id === c.id && (!q || i.name.includes(q))) })).filter((c) => c.items.length);

  const save = async () => {
    const body = { ...f, places: f.places, price_cap: Number(f.price_cap) || null, order_cap: Number(f.order_cap) || null };
    const ok = await run(() => (initial.id ? api(`/events/${initial.id}`, { method: 'PUT', body }) : api('/events', { method: 'POST', body })), 'تم الحفظ');
    if (ok) onSaved();
  };
  const del = async () => { if (window.confirm('حذف هذه الفعالية؟') && await run(() => api(`/events/${initial.id}`, { method: 'DELETE' }), 'تم الحذف')) onSaved(); };

  return (
    <Modal title={initial.id ? 'تعديل الفعالية' : 'فعالية مؤسسة جديدة'} onClose={onClose} wide footer={
      <>{initial.id && <button className="btn btn-danger-ghost" onClick={del}><Trash2 size={16} /> حذف</button>}<button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>حفظ</button></>
    }>
      <div className="ev-form">
        <div className="grid-2">
          <Field label="اسم المؤسسة / الفعالية *"><input value={f.name} onChange={set('name')} autoFocus placeholder="مثال: شركة الأفق" /></Field>
          <Field label="المسؤول (اختياري)"><input value={f.contact_name} onChange={set('contact_name')} /></Field>
          <Field label="جوال المسؤول"><input dir="ltr" value={f.contact_phone} onChange={set('contact_phone')} /></Field>
          <Field label="أماكن/طاولات المؤسسة (سطر لكل مكان، اختياري)" hint="إن تركتها فارغة يكتب الموظف مكانه بنفسه"><textarea rows={2} value={f.places} onChange={set('places')} placeholder={'قاعة 1\nقاعة 2'} /></Field>
          <Field label="يبدأ الطلب *"><input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></Field>
          <Field label="ينتهي الطلب *"><input type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></Field>
        </div>

        <h4>قائمة الطلب</h4>
        <div className="ev-modes" role="radiogroup" aria-label="نوع القائمة">
          {[['selected', ListChecks, 'قائمة محددة', 'تختار أنت الأصناف المتاحة لهم'], ['full', Utensils, 'القائمة كاملة', 'يطلبون من كل أصناف المطعم'], ['cap', BadgePercent, 'سقف للسعر', 'كل الأصناف التي سعرها حتى حدّ معيّن']].map(([k, I, t, d]) => (
            <button key={k} role="radio" aria-checked={f.menu_mode === k} className={`ev-mode ${f.menu_mode === k ? 'on' : ''}`} onClick={() => setF({ ...f, menu_mode: k })}><I size={22} aria-hidden /><strong>{t}</strong><small>{d}</small></button>
          ))}
        </div>
        {f.menu_mode === 'cap' && <Field label="أقصى سعر للصنف الواحد *"><input type="number" min="0" step="0.5" value={f.price_cap} onChange={set('price_cap')} /></Field>}
        {f.menu_mode === 'selected' && (
          <div className="ev-picker">
            <div className="ev-picker-head">
              <label className="search-field"><Search size={16} aria-hidden /><input type="search" placeholder="بحث عن صنف" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              <strong>{f.item_ids.length} صنف محدد</strong>
            </div>
            <div className="ev-picker-list">
              {cats.map((c) => {
                const ids = c.items.map((i) => i.id);
                const all = ids.every((i) => sel.has(i));
                return (
                  <div key={c.id} className="ev-cat">
                    <label className="ev-cat-head"><input type="checkbox" checked={all} onChange={(e) => toggleCat(ids, e.target.checked)} /> <b>{c.name}</b> <small>{ids.filter((i) => sel.has(i)).length}/{ids.length}</small></label>
                    <div className="ev-items">
                      {c.items.map((i) => <label key={i.id} className={`ev-item ${sel.has(i.id) ? 'on' : ''}`}><input type="checkbox" checked={sel.has(i.id)} onChange={() => toggleItem(i.id)} /><span>{i.name}</span><em>{money(i.price)}</em></label>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <h4>الحدود والحساب</h4>
        <div className="grid-2">
          <Field label="سقف مجموع الطلب الواحد (اختياري)" hint="قبل الضريبة؛ لا يستطيع الموظف تجاوزه"><input type="number" min="0" step="1" value={f.order_cap} onChange={set('order_cap')} /></Field>
          <Field label="طريقة الحساب">
            <select value={f.billing} onChange={set('billing')}>
              <option value="institution">على المؤسسة (تُحصَّل دفعة واحدة)</option>
              <option value="individual">كل موظف يدفع طلبه</option>
            </select>
          </Field>
        </div>
        <label className="switch"><input type="checkbox" checked={f.needs_approval} onChange={set('needs_approval')} /> يحتاج كل طلب اعتماد الموظف قبل وصوله للمطبخ</label>
        <Field label="ملاحظات"><input value={f.notes} onChange={set('notes')} /></Field>

        <h4>ترحيب وخدمة العملاء</h4>
        <Field label="رسالة الترحيب" hint="تظهر للموظف عند مسح QR. اتركها فارغة لتظهر الرسالة الافتراضية: «نتمنى لكم قضاء أجمل الأوقات»"><textarea rows={2} maxLength={400} value={f.welcome_message} onChange={set('welcome_message')} placeholder={`أهلاً بكم في ${f.name || 'المؤسسة'}، نتمنى لكم قضاء أجمل الأوقات`} /></Field>
        <div className="grid-2">
          <Field label="رقم خدمة العملاء" hint="يُترك فارغاً لاستخدام رقم المطعم"><input dir="ltr" inputMode="tel" value={f.support_phone} onChange={set('support_phone')} /></Field>
          <label className="switch" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.support_chat} onChange={set('support_chat')} /> السماح بمراسلة المطعم من الصفحة</label>
        </div>
      </div>
    </Modal>
  );
}

function EventDetail({ id, canSettle, onClose }) {
  const money = useMoney();
  const { data, reload } = useData(`/events/${id}`, ['orders'], [id]);
  const [run, busy] = useAction();
  const [method, setMethod] = useState('card');
  const settle = async () => {
    if (!window.confirm(`تحصيل ${money(data.total - data.paid)} من المؤسسة وإغلاق كل طلباتها المفتوحة؟`)) return;
    const r = await run(() => api(`/events/${id}/settle`, { method: 'POST', body: { method } }));
    if (r) { window.alert(`تم تحصيل ${r.settled} طلب بإجمالي ${money(r.total)}${r.skipped ? ` (تخطّي ${r.skipped})` : ''}`); reload(); }
  };
  if (!data) return <Modal title="كشف الحساب" onClose={onClose}><Loading /></Modal>;
  const remaining = Math.round((data.total - data.paid) * 100) / 100;
  const live = data.orders.filter((o) => o.status !== 'cancelled');
  return (
    <Modal title={`كشف حساب: ${data.name}`} onClose={onClose} wide footer={
      <>
        {canSettle && data.billing === 'institution' && data.open_orders > 0 && (
          <>
            <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="طريقة التحصيل">{Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn btn-ok" onClick={settle} disabled={busy}><Banknote size={16} /> تحصيل من المؤسسة · {money(remaining)}</button>
          </>
        )}
        <button className="btn btn-primary" onClick={() => window.print()}><Printer size={16} /> طباعة الكشف</button>
      </>
    }>
      <div className="ev-statement">
        <header><h3>{data.name}</h3><p>{when(data.starts_at)} ← {when(data.ends_at)} · {data.billing === 'institution' ? 'الحساب على المؤسسة' : 'كل موظف يدفع'}</p></header>
        <dl className="ev-stats">
          <div><dt>عدد الطلبات</dt><dd>{live.length}</dd></div>
          <div><dt>الإجمالي</dt><dd>{money(data.total)}</dd></div>
          <div><dt>المحصّل</dt><dd>{money(data.paid)}</dd></div>
          <div><dt>المتبقي</dt><dd>{money(remaining)}</dd></div>
        </dl>
        {!data.orders.length ? <p className="muted">لا توجد طلبات بعد.</p> : (
          <table className="data">
            <thead><tr><th>الكود</th><th>الموظف</th><th>المكان</th><th>الوقت</th><th>أصناف</th><th>الحالة</th><th>المبلغ</th></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className={o.status === 'cancelled' ? 'muted' : ''}>
                  <td dir="ltr">{o.code}</td><td>{o.customer_name}</td><td>{o.place || '—'}</td><td>{String(o.created_at).slice(11, 16)}</td><td>{o.items_count}</td>
                  <td>{o.status === 'paid' ? 'مدفوع' : o.status === 'cancelled' ? 'ملغى' : o.pending_confirm ? 'بانتظار الاعتماد' : 'مفتوح'}</td><td>{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th colSpan={6}>الإجمالي</th><th>{money(data.total)}</th></tr></tfoot>
          </table>
        )}
      </div>
    </Modal>
  );
}

/** بطاقة QR للمؤسسة: تُطبع وتوضع على الطاولات */
function Poster({ ev, onClose, onRotate }) {
  const money = useMoney();
  const { settings } = useApp();
  const { data, reload } = useData(`/events/${ev.id}`, [], [ev.id]);
  const [run] = useAction();
  const url = data ? eventUrl(data.token) : '';
  const rotate = async () => {
    if (!window.confirm('تغيير الرمز؟ ستتوقف البطاقات المطبوعة سابقاً عن العمل.')) return;
    if (await run(() => api(`/events/${ev.id}/rotate-token`, { method: 'POST' }), 'تم تغيير الرمز، اطبع البطاقة الجديدة')) { reload(); onRotate?.(); }
  };
  return (
    <Modal title={`QR المؤسسة: ${ev.name}`} onClose={onClose} wide footer={
      <><button className="btn btn-danger-ghost" onClick={rotate}><RefreshCw size={16} /> تغيير الرمز</button><button className="btn btn-primary btn-lg" onClick={() => window.print()}><Printer size={17} /> طباعة البطاقة</button></>
    }>
      {!data ? <Loading /> : (
        <div className="ev-poster">
          <span className="ev-poster-rest">{settings.restaurant_name}</span>
          <h2>{ev.name}</h2>
          <p className="ev-poster-sub">قائمة مخصصة لموظفي المؤسسة</p>
          <div className="ev-poster-qr" data-url={url}><Qr url={url} size={260} /></div>
          <strong className="ev-poster-cta">امسح الرمز واطلب من هاتفك</strong>
          <ul className="ev-poster-rules">
            <li>{MODE[ev.menu_mode]}{ev.menu_mode === 'selected' ? ` (${ev.item_count} صنف)` : ev.menu_mode === 'cap' ? ` · حتى ${money(ev.price_cap)} للصنف` : ''}</li>
            {ev.order_cap ? <li>سقف الطلب الواحد {money(ev.order_cap)}</li> : null}
            <li>{ev.billing === 'institution' ? 'الحساب على المؤسسة' : 'الدفع على كل موظف'}</li>
            <li>متاح من {when(ev.starts_at)} إلى {when(ev.ends_at)}</li>
          </ul>
          <small className="ev-poster-host" dir="ltr">{url.split('#')[0].replace(/^https?:\/\//, '')}</small>
        </div>
      )}
    </Modal>
  );
}
