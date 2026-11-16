import { useState } from 'react';
import { api } from '../api.js';
import { useData, useAction, Modal, Field, Loading, Empty, PageHead, todayStr, timeOf } from '../lib.jsx';

const STATUS = { booked: 'محجوز', seated: 'حضر', cancelled: 'ملغى', no_show: 'لم يحضر' };

export default function Reservations() {
  const [date, setDate] = useState(todayStr());
  const { data, loading, reload } = useData(`/reservations?date=${date}`, ['reservations'], [date]);
  const tables = useData('/tables');
  const [run] = useAction();
  const [edit, setEdit] = useState(null);

  const setStatus = async (r, status) => { if (await run(() => api(`/reservations/${r.id}`, { method: 'PUT', body: { status } }))) reload(); };

  return (
    <div>
      <PageHead title="الحجوزات">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="التاريخ" />
        <button className="btn btn-primary" onClick={() => setEdit({ reserved_at: `${date}T20:00`, party_size: 2 })}>+ حجز</button>
      </PageHead>
      {loading ? <Loading /> : !data?.length ? <Empty icon="📅" text="لا توجد حجوزات في هذا اليوم" /> : (
        <div className="cards">
          {data.map((r) => (
            <div key={r.id} className={`card res res-${r.status}`}>
              <div className="res-time">{timeOf(r.reserved_at)}</div>
              <div className="res-body">
                <strong>{r.customer_name}</strong>
                <span className="muted">👤 {r.party_size} · {r.table_name || 'بدون طاولة'}{r.phone ? ` · ${r.phone}` : ''}</span>
                {r.notes && <small>📝 {r.notes}</small>}
              </div>
              <div className="res-actions">
                <span className="badge">{STATUS[r.status]}</span>
                {r.status === 'booked' && (
                  <>
                    <button className="btn btn-sm btn-ok" onClick={() => setStatus(r, 'seated')}>حضر</button>
                    <button className="btn btn-sm" onClick={() => setStatus(r, 'no_show')}>لم يحضر</button>
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => setStatus(r, 'cancelled')}>إلغاء</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEdit({ ...r, reserved_at: r.reserved_at.replace(' ', 'T').slice(0, 16) })}>✎</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <ResForm res={edit} tables={tables.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      )}
    </div>
  );
}

function ResForm({ res, tables, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({
    customer_name: res.customer_name || '', phone: res.phone || '', party_size: res.party_size || 2,
    reserved_at: res.reserved_at, table_id: res.table_id || '', notes: res.notes || '',
  });
  const save = async () => {
    const body = { ...f, table_id: f.table_id || null };
    const ok = await run(() => (res.id ? api(`/reservations/${res.id}`, { method: 'PUT', body }) : api('/reservations', { method: 'POST', body })), 'تم حفظ الحجز');
    if (ok) onSaved();
  };
  return (
    <Modal title={res.id ? 'تعديل الحجز' : 'حجز جديد'} onClose={onClose} footer={<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>}>
      <div className="grid-2">
        <Field label="اسم العميل"><input value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} autoFocus /></Field>
        <Field label="الجوال"><input dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="الموعد"><input type="datetime-local" value={f.reserved_at} onChange={(e) => setF({ ...f, reserved_at: e.target.value })} /></Field>
        <Field label="عدد الأشخاص"><input type="number" min="1" value={f.party_size} onChange={(e) => setF({ ...f, party_size: e.target.value })} /></Field>
        <Field label="الطاولة">
          <select value={f.table_id} onChange={(e) => setF({ ...f, table_id: Number(e.target.value) || '' })}>
            <option value="">— لاحقاً —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.seats} أشخاص)</option>)}
          </select>
        </Field>
        <Field label="ملاحظات"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
