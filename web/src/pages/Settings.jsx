import { useEffect, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import { api, isNative, getServerUrl, setServerUrl } from '../api.js';
import { useNotifications, devicePermission, requestDevicePermission } from '../notifications.jsx';
import { useApp, useAction, useData, Field, PageHead, Modal } from '../lib.jsx';

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
