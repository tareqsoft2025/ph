import { useEffect, useState } from 'react';
import { BellRing, Send, QrCode, Printer, ShieldAlert } from 'lucide-react';
import Qr from '../components/Qr.jsx';
import { api, isNative, getServerUrl, setServerUrl } from '../api.js';
import { useNotifications, devicePermission, requestDevicePermission } from '../notifications.jsx';
import { useApp, useAction, useData, useToast, Field, PageHead, Modal } from '../lib.jsx';

export default function Settings() {
  const { settings, setSettings } = useApp();
  const [run, busy] = useAction();
  const [f, setF] = useState(settings);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });

  const save = async () => {
    const s = await run(() => api('/settings', { method: 'PUT', body: f }), 'تم حفظ الإعدادات');
    if (s) setSettings(s);
  };

  return (
    <div>
      <PageHead title="الإعدادات">
        <button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>
      </PageHead>
      <div className="report-grid">
        <OnlineOrderingSettings />
        <section className="card">
          <h3>بيانات المطعم</h3>
          <Field label="اسم المطعم"><input value={f.restaurant_name} onChange={set('restaurant_name')} /></Field>
          <Field label="العنوان"><input value={f.address} onChange={set('address')} /></Field>
          <div className="grid-2">
            <Field label="الهاتف"><input dir="ltr" value={f.phone} onChange={set('phone')} /></Field>
            <Field label="الرقم الضريبي"><input dir="ltr" value={f.tax_number} onChange={set('tax_number')} /></Field>
          </div>
          <Field label="تذييل الفاتورة"><input value={f.receipt_footer} onChange={set('receipt_footer')} /></Field>
        </section>
        <section className="card">
          <h3>الضرائب والرسوم</h3>
          <div className="grid-2">
            <Field label="العملة"><input value={f.currency} onChange={set('currency')} /></Field>
            <Field label="نسبة الضريبة %"><input type="number" value={f.tax_rate} onChange={set('tax_rate')} /></Field>
            <Field label="رسوم الخدمة للصالة %"><input type="number" value={f.service_rate} onChange={set('service_rate')} /></Field>
            <Field label="رسوم التوصيل"><input type="number" value={f.delivery_fee} onChange={set('delivery_fee')} /></Field>
            <Field label="نقاط الولاء لكل وحدة عملة"><input type="number" step="0.1" value={f.loyalty_points_per_unit} onChange={set('loyalty_points_per_unit')} /></Field>
          </div>
          <label className="switch"><input type="checkbox" checked={f.tax_inclusive === '1'} onChange={set('tax_inclusive')} /> الأسعار شاملة الضريبة</label>
        </section>
        <section className="card">
          <h3>الموارد البشرية</h3>
          <div className="grid-2">
            <Field label="سماحية التأخير (دقيقة)" hint="لا يُحتسب التأخير إذا كان ضمن هذه المدة"><input type="number" min="0" value={f.late_grace_minutes} onChange={set('late_grace_minutes')} /></Field>
            <Field label="التنبيه قبل انتهاء المستندات (يوم)"><input type="number" min="1" value={f.doc_alert_days} onChange={set('doc_alert_days')} /></Field>
          </div>
          <label className="switch"><input type="checkbox" checked={f.late_deduction === '1'} onChange={set('late_deduction')} /> خصم دقائق التأخير من الراتب</label>
        </section>
        <section className="card">
          <h3>حماية تسجيل الحضور</h3>
          <Field label="أقصى خطأ مقبول في دقة الموقع (متر)" hint="القراءات الأقل دقة تُرفض"><input type="number" min="10" max="500" value={f.att_max_accuracy} onChange={set('att_max_accuracy')} /></Field>
          <div className="switch-list">
            <label className="switch"><input type="checkbox" checked={f.att_require_location === '1'} onChange={set('att_require_location')} /> التحقق من موقع العمل عند التسجيل</label>
            <label className="switch"><input type="checkbox" checked={f.att_required_before_work === '1'} onChange={set('att_required_before_work')} /> تسجيل الحضور إلزامي قبل استخدام النظام (للموظفين في أيام عملهم)</label>
            <label className="switch"><input type="checkbox" checked={f.att_block_mock === '1'} onChange={set('att_block_mock')} /> رفض المواقع الوهمية والمحاكيات والأجهزة المكسورة الحماية</label>
            <label className="switch"><input type="checkbox" checked={f.att_allow_web === '1'} onChange={set('att_allow_web')} /> السماح بالتسجيل من المتصفح (الأكثر أماناً: تطبيق الجوال فقط)</label>
          </div>
        </section>
        <PushSettings />
        <TablesSettings />
        {isNative && (
          <section className="card">
            <h3>اتصال التطبيق</h3>
            <p className="muted">الخادم الحالي: <span dir="ltr">{getServerUrl()}</span></p>
            <button className="btn" onClick={() => { setServerUrl(''); window.location.reload(); }}>تغيير الخادم</button>
          </section>
        )}
      </div>
    </div>
  );
}

function TablesSettings() {
  const { data, reload } = useData('/tables', ['tables']);
  const [run, busy] = useAction();
  const [edit, setEdit] = useState(null);
  const save = async () => {
    const body = { name: edit.name, seats: Number(edit.seats) || 4, area: edit.area };
    const ok = await run(() => (edit.id ? api(`/tables/${edit.id}`, { method: 'PUT', body }) : api('/tables', { method: 'POST', body })), 'تم الحفظ');
    if (ok) { setEdit(null); reload(); }
  };
  const del = async () => {
    if (!window.confirm('حذف الطاولة؟')) return;
    if (await run(() => api(`/tables/${edit.id}`, { method: 'DELETE' }), 'تم الحذف')) { setEdit(null); reload(); }
  };
  return (
    <section className="card">
      <h3>الطاولات</h3>
      <div className="chip-list">
        {(data || []).map((t) => <button key={t.id} className="chip" onClick={() => setEdit(t)}>{t.name} · {t.area}</button>)}
        <button className="chip chip-add" onClick={() => setEdit({ name: '', seats: 4, area: 'الصالة' })}>+ طاولة</button>
      </div>
      {edit && (
        <Modal title={edit.id ? 'تعديل طاولة' : 'طاولة جديدة'} onClose={() => setEdit(null)} footer={
          <>{edit.id && <button className="btn btn-danger-ghost" onClick={del}>حذف</button>}<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button></>
        }>
          <div className="grid-2">
            <Field label="الاسم"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="عدد المقاعد"><input type="number" value={edit.seats} onChange={(e) => setEdit({ ...edit, seats: e.target.value })} /></Field>
            <Field label="المنطقة"><input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </section>
  );
}

const PUSH_TEXT = {
  active: ['badge-ok', 'مفعّلة على هذا الجهاز', 'ستصلك الإشعارات حتى لو كان التطبيق مغلقاً.'],
  pending: ['', 'جارِ التفعيل…', ''],
  'not-configured': ['badge-warn', 'غير مهيّأة في التطبيق', 'هذه النسخة من التطبيق لا تحتوي إعدادات Firebase (google-services.json). راجع docs/FIREBASE.md.'],
  'server-disabled': ['badge-warn', 'غير مفعّلة على الخادم', 'أضف ملف حساب خدمة Firebase على جهاز الخادم ثم أعد تشغيله. راجع docs/FIREBASE.md.'],
  denied: ['badge-err', 'مرفوضة', 'اسمح للتطبيق بالإشعارات من إعدادات الجهاز ثم أعد المحاولة.'],
  unsupported: ['', 'المتصفح', 'في المتصفح تصل الإشعارات والصفحة مفتوحة (ولو في الخلفية). للإشعارات والتطبيق مغلق استخدم تطبيق الأندرويد.'],
};

function PushSettings() {
  const { push, enablePush } = useNotifications();
  const [run, busy] = useAction();
  const [perm, setPerm] = useState('default');
  useEffect(() => { devicePermission().then(setPerm).catch(() => {}); }, []);
  const [cls, label, hint] = PUSH_TEXT[push.state] || PUSH_TEXT.unsupported;
  return (
    <section className="card">
      <h3>الإشعارات</h3>
      <div className="kv"><span>الإشعارات الفورية (Firebase)</span><span className={`badge ${cls}`}>{label}</span></div>
      {hint && <p className="muted small" style={{ marginTop: 8 }}>{hint}</p>}
      {!isNative && <div className="kv"><span>إشعارات المتصفح</span><span className={`badge ${perm === 'granted' ? 'badge-ok' : perm === 'denied' ? 'badge-err' : ''}`}>{perm === 'granted' ? 'مسموحة' : perm === 'denied' ? 'محظورة' : 'غير مفعّلة'}</span></div>}
      <div className="btn-row" style={{ marginTop: 16 }}>
        {isNative && push.state !== 'active' && <button className="btn" onClick={enablePush} disabled={push.state === 'pending'}><BellRing size={17} /> تفعيل الإشعارات الفورية</button>}
        {!isNative && perm === 'default' && <button className="btn" onClick={async () => setPerm(await requestDevicePermission())}><BellRing size={17} /> السماح بإشعارات المتصفح</button>}
        <button className="btn" onClick={() => run(() => api('/push/test', { method: 'POST' }), 'تم إرسال إشعار تجريبي')} disabled={busy}><Send size={17} /> إرسال إشعار تجريبي</button>
      </div>
    </section>
  );
}

/** الطلب من رمز QR الطاولة: يُفعَّل ويُلغى فوراً */
function useOrderBase() {
  return (isNative ? `${getServerUrl()}/` : `${window.location.origin}${window.location.pathname}`) + '#/t/';
}

function OnlineOrderingSettings() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const on = settings.online_ordering === '1';
  const put = async (key, value) => {
    try { setSettings(await api('/settings', { method: 'PUT', body: { [key]: value } })); toast('تم الحفظ'); } catch (e) { toast(e.message, 'err'); }
  };
  const flip = async () => {
    const next = on ? '0' : '1';
    try {
      setSettings(await api('/settings', { method: 'PUT', body: { online_ordering: next } }));
      toast(next === '1' ? 'تم تفعيل الطلب عبر QR' : 'تم إيقاف الطلب عبر QR فوراً', next === '1' ? 'ok' : 'warn');
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <section className="card online-card">
      <h3><QrCode size={18} aria-hidden /> الطلب من رمز QR الطاولة</h3>
      <p className="muted small">لكل طاولة رمز QR خاص بها (رمز عشوائي مشفّر لا يمكن تخمينه). يمسحه الزبون من هاتفه فيشاهد المنيو ويرسل طلبه للمطبخ على طاولته فقط. لا يوجد رابط عام للطلب.</p>
      <label className={`switch online-main ${on ? 'on' : ''}`}>
        <input type="checkbox" checked={on} onChange={flip} />
        <span>{on ? 'الطلب عبر QR مفعّل' : 'الطلب عبر QR متوقف'}</span>
      </label>
      <div className="qr-sec">
        <h4>الأمان</h4>
        <label className="switch"><input type="checkbox" checked={settings.qr_allow_bill === '1'} onChange={() => put('qr_allow_bill', settings.qr_allow_bill === '1' ? '0' : '1')} /> السماح للزبون بطلب الحساب من هاتفه (محفظة / بنك / جوال بي / نقداً) فيصلك للكاشير</label>
        <label className="switch"><input type="checkbox" checked={settings.qr_require_open === '1'} onChange={() => put('qr_require_open', settings.qr_require_open === '1' ? '0' : '1')} /> لا يُقبل طلب إلا بعد أن يفتح النادل الطاولة (موصى به)</label>
        <div className="grid-2">
          <Field label="تأكيد الموظف قبل المطبخ">
            <select value={settings.qr_confirm_mode} onChange={(e) => put('qr_confirm_mode', e.target.value)}>
              <option value="smart">ذكي: حسب المبلغ وأول طلب لكل جوال</option>
              <option value="always">دائماً لكل طلب</option>
              <option value="never">بدون تأكيد (مباشرة للمطبخ)</option>
            </select>
          </Field>
          {settings.qr_confirm_mode === 'smart' && (
            <Field label={`المبلغ الذي يحتاج ما فوقه تأكيداً (${settings.currency})`}>
              <input type="number" min="0" defaultValue={settings.qr_confirm_over} onBlur={(e) => e.target.value !== settings.qr_confirm_over && put('qr_confirm_over', e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="مدة نسيان بيانات الزيارة (بالساعات)" hint="بعدها يعدّ الجهاز عودة الزبون زيارة جديدة: يُنسى آخر طلبه وتبدأ محادثة جديدة ولا يُضاف على طلبه القديم. من 1 إلى 168 ساعة.">
          <input type="number" min="1" max="168" defaultValue={settings.customer_forget_hours || 8} onBlur={(e) => { const v = String(Math.min(168, Math.max(1, Math.round(Number(e.target.value)) || 8))); e.target.value = v; if (v !== String(settings.customer_forget_hours || 8)) put('customer_forget_hours', v); }} />
        </Field>
        <p className="muted small">طلب مفتوح واحد لكل جوال وجهاز، وتُسجَّل كل المحاولات وتصلك تنبيهات عند أي نمط مشبوه.</p>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Printer size={16} /> بطاقات QR للطاولات وطباعتها</button>
        <button className="btn" onClick={() => setLogOpen(true)}><ShieldAlert size={16} /> سجل محاولات QR</button>
      </div>
      {open && <TableQrs onClose={() => setOpen(false)} />}
      {logOpen && <QrLog onClose={() => setLogOpen(false)} />}
    </section>
  );
}

/** بطاقات QR: كل بطاقة مرتبطة بطاولتها فقط، وتُطبع كلها أو بطاقة واحدة */
function TableQrs({ onClose }) {
  const base = useOrderBase();
  const toast = useToast();
  const { settings } = useApp();
  const { data, reload } = useData('/tables/qr', ['tables']);
  const [one, setOne] = useState(null);
  const printNow = (id) => {
    setOne(id);
    const done = () => { setOne(null); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 80);
  };
  const rotate = async (t) => {
    if (!window.confirm(`تغيير رمز ${t.name}؟ ستتوقف البطاقة المطبوعة القديمة عن العمل ويجب طباعة بطاقة جديدة.`)) return;
    try { await api(`/tables/${t.id}/qr/rotate`, { method: 'POST' }); toast('تم تغيير الرمز، اطبع البطاقة الجديدة'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="بطاقات QR للطاولات" onClose={onClose} wide>
      <div className={`qr-sheet ${one ? 'one' : ''}`}>
        <div className="qr-actions btn-row"><button className="btn btn-primary" onClick={() => { setOne(null); setTimeout(() => window.print(), 50); }}><Printer size={17} /> طباعة كل البطاقات</button></div>
        <div className="qr-grid">
          {(data || []).map((t) => (
            <div key={t.id} className={`qr-card ${one === t.id ? 'sel' : ''}`} data-url={`${base}${t.token}`}>
              <strong>{settings.restaurant_name}</strong>
              <Qr url={`${base}${t.token}`} size={150} />
              <span className="qr-table">{t.name}</span>
              <small className="qr-host" dir="ltr">{new URL(base, window.location.href).host}</small>
              <small>امسح الرمز لعرض المنيو وإرسال طلبك</small>
              <span className="qr-card-actions">
                <button className="btn btn-sm" onClick={() => printNow(t.id)}><Printer size={14} /> طباعة</button>
                <button className="btn btn-sm btn-danger-ghost" onClick={() => rotate(t)}>تغيير الرمز</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const QR_EVENTS = {
  bad_token: ['رمز غير صالح', 'badge-err'], closed_attempt: ['محاولة على طاولة مغلقة', 'badge-warn'], dup_open: ['طلب مفتوح مسبقاً', 'badge-warn'],
  rate_limited: ['كثرة طلبات', 'badge-err'], confirm_required: ['بانتظار التأكيد', 'badge-warn'], order: ['طلب', 'badge-ok'],
};

function QrLog({ onClose }) {
  const { data, loading } = useData('/qr/log', ['orders']);
  return (
    <Modal title="سجل محاولات QR" onClose={onClose} wide>
      {loading && !data ? <p className="muted">جارِ التحميل…</p> : !data?.length ? <p className="muted">لا توجد محاولات بعد.</p> : (
        <ul className="qrlog">
          {data.map((l) => (
            <li key={l.id}>
              <span className={`badge ${QR_EVENTS[l.event]?.[1] || ''}`}>{QR_EVENTS[l.event]?.[0] || l.event}</span>
              <span className="qrlog-main">{l.table_name || '—'}{l.detail ? ` · ${l.detail}` : ''}</span>
              <small className="muted" dir="ltr">{l.ip}{l.device_id ? ` · ${String(l.device_id).slice(0, 6)}` : ''}</small>
              <small className="muted">{String(l.at).slice(5, 16).replace('T', ' ')}</small>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
