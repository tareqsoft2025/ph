import { useState } from 'react';
import { api } from '../api.js';
import { useAction, useData, Modal, Field, LEAVE_TYPES, todayStr } from '../lib.jsx';

/** طلب إجازة (للموظف) أو إضافتها مباشرة (للمدير) */
export default function LeaveForm({ employeeId, manager, chooseEmployee, onClose, onSaved }) {
  const [run, busy] = useAction();
  const emps = useData(chooseEmployee ? '/employees' : null);
  const [f, setF] = useState({ employee_id: employeeId || '', type: 'annual', start_date: todayStr(), end_date: todayStr(), reason: '', approve: !!manager });
  const days = f.start_date && f.end_date && f.end_date >= f.start_date
    ? Math.round((new Date(`${f.end_date}T00:00`) - new Date(`${f.start_date}T00:00`)) / 864e5) + 1 : 0;

  async function save() {
    const body = { ...f, employee_id: f.employee_id || undefined };
    if (await run(() => api('/leaves', { method: 'POST', body }), manager && f.approve ? 'تمت إضافة الإجازة' : 'تم إرسال الطلب')) onSaved();
  }

  return (
    <Modal title={manager ? 'إضافة إجازة' : 'طلب إجازة'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !days || (chooseEmployee && !f.employee_id)}>{manager && f.approve ? 'حفظ' : 'إرسال الطلب'}</button>
      </>
    }>
      {chooseEmployee && (
        <Field label="الموظف">
          <select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: Number(e.target.value) || '' })}>
            <option value="">— اختر —</option>
            {(emps.data || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="نوع الإجازة">
        <div className="seg seg-lg">
          {Object.entries(LEAVE_TYPES).map(([k, v]) => (
            <button type="button" key={k} className={f.type === k ? 'active' : ''} onClick={() => setF({ ...f, type: k })}>{v}</button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="من"><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: e.target.value > f.end_date ? e.target.value : f.end_date })} /></Field>
        <Field label="إلى"><input type="date" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
      </div>
      <p className="muted small">المدة: <strong>{days}</strong> يوم</p>
      <Field label="السبب"><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      {manager && <label className="switch"><input type="checkbox" checked={f.approve} onChange={(e) => setF({ ...f, approve: e.target.checked })} /> اعتمادها مباشرة</label>}
    </Modal>
  );
}
