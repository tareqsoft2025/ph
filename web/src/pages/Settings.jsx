import { useEffect, useState } from 'react';
import { BellRing, Send, Link2, Copy, QrCode, Printer, ExternalLink, Check } from 'lucide-react';
import QRCode from 'qrcode';
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

/** رابط الطلب العام للزبائن: يُفعَّل ويُلغى فوراً */
function useOrderBase() {
  return (isNative ? `${getServerUrl()}/` : `${window.location.origin}${window.location.pathname}`) + '#/order';
}

function Qr({ url, size = 200 }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc('')); }, [url, size]);
  return src ? <img src={src} alt="رمز QR" width={size} height={size} /> : <div style={{ width: size, height: size }} />;
}

function OnlineOrderingSettings() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const base = useOrderBase();
  const [qrOpen, setQrOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const on = settings.online_ordering === '1';
  const flip = async (key) => {
    const next = settings[key] === '1' ? '0' : '1';
    try {
      setSettings(await api('/settings', { method: 'PUT', body: { [key]: next } }));
      if (key === 'online_ordering') toast(next === '1' ? 'تم تفعيل الطلب عبر الرابط' : 'تم إيقاف الطلب عبر الرابط فوراً', next === '1' ? 'ok' : 'warn');
    } catch (e) { toast(e.message, 'err'); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(base); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt('انسخ الرابط', base); }
  };
  const types = [['online_dine_in', 'الطلب من الطاولة (QR)'], ['online_takeaway', 'طلب سفري'], ['online_delivery', 'طلب توصيل']];
  return (
    <section className="card online-card">
      <h3><Link2 size={18} aria-hidden /> الطلب عبر الرابط (للزبائن)</h3>
      <p className="muted small">يفتح الزبون الرابط من هاتفه فيشاهد المنيو ويرسل طلبه للمطبخ مباشرة بدون تسجيل دخول. يمكنك إيقافه في أي وقت.</p>
      <label className={`switch online-main ${on ? 'on' : ''}`}>
        <input type="checkbox" checked={on} onChange={() => flip('online_ordering')} />
        <span>{on ? 'الطلب عبر الرابط مفعّل' : 'الطلب عبر الرابط متوقف'}</span>
      </label>
      {on && (
        <>
          <div className="online-link">
            <input readOnly dir="ltr" value={base} onFocus={(e) => e.target.select()} aria-label="رابط الطلب" />
            <button className="btn" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'تم النسخ' : 'نسخ'}</button>
          </div>
          <div className="btn-row">
            <a className="btn" href={base} target="_blank" rel="noreferrer"><ExternalLink size={16} /> فتح الرابط</a>
            <button className="btn" onClick={() => setQrOpen(true)}><QrCode size={16} /> رمز QR</button>
            <button className="btn" onClick={() => setTablesOpen(true)}><Printer size={16} /> QR لكل طاولة</button>
          </div>
          <div className="switch-list" style={{ marginTop: 12 }}>
            {types.map(([k, label]) => (
              <label key={k} className="switch"><input type="checkbox" checked={settings[k] === '1'} onChange={() => flip(k)} /> {label}</label>
            ))}
          </div>
        </>
      )}
      {qrOpen && (
        <Modal title="رمز QR للرابط" onClose={() => setQrOpen(false)}>
          <div className="qr-one"><Qr url={base} size={260} /><p className="muted small" dir="ltr">{base}</p></div>
        </Modal>
      )}
      {tablesOpen && <TableQrs base={base} onClose={() => setTablesOpen(false)} />}
    </section>
  );
}

function TableQrs({ base, onClose }) {
  const { data } = useData('/tables', ['tables']);
  const { settings } = useApp();
  return (
    <Modal title="رموز QR للطاولات" onClose={onClose} wide>
      <div className="qr-sheet">
        <div className="qr-actions btn-row"><button className="btn btn-primary" onClick={() => window.print()}><Printer size={17} /> طباعة</button></div>
        <div className="qr-grid">
          {(data || []).map((t) => (
            <div key={t.id} className="qr-card">
              <strong>{settings.restaurant_name}</strong>
              <Qr url={`${base}?table=${t.id}`} size={150} />
              <span className="qr-table">{t.name}</span>
              <small>امسح الرمز واطلب من هاتفك</small>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
