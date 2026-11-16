import { useState } from 'react';
import { api } from '../api.js';
import { useAction, Modal, Field, todayStr, timeOf } from '../lib.jsx';

/** تسجيل أو تعديل حضور يدوي (للمدير) */
export default function AttendanceForm({ rec, name, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({
    date: rec.date || todayStr(),
    status: rec.status || 'present',
    check_in: rec.check_in ? timeOf(rec.check_in) : (rec.work_start || ''),
    check_out: rec.check_out ? timeOf(rec.check_out) : '',
    note: rec.note || '',
  });

  async function save() {
    if (await run(() => api('/attendance', { method: 'POST', body: { ...f, employee_id: rec.employee_id } }), 'تم الحفظ')) onSaved();
  }
  async function remove() {
    if (!window.confirm('حذف سجل هذا اليوم؟')) return;
    if (await run(() => api(`/attendance/${rec.id}`, { method: 'DELETE' }), 'تم الحذف')) onSaved();
  }

  return (
    <Modal title={`حضور ${name || ''}`} onClose={onClose} footer={
      <>
        {rec.id && <button className="btn btn-danger-ghost" onClick={remove} disabled={busy}>حذف السجل</button>}
        <button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>
      </>
    }>
      <Field label="التاريخ"><input type="date" value={f.date} max={todayStr()} onChange={(e) => setF({ ...f, date: e.target.value })} disabled={!!rec.id} /></Field>
      <Field label="الحالة">
        <div className="seg seg-lg">
          {[['present', 'حاضر'], ['absent', 'غائب'], ['leave', 'إجازة']].map(([k, v]) => (
            <button type="button" key={k} className={f.status === k ? 'active' : ''} onClick={() => setF({ ...f, status: k })}>{v}</button>
          ))}
        </div>
      </Field>
      {f.status === 'present' && (
        <div className="grid-2">
          <Field label="وقت الحضور"><input type="time" value={f.check_in} onChange={(e) => setF({ ...f, check_in: e.target.value })} /></Field>
          <Field label="وقت الانصراف"><input type="time" value={f.check_out} onChange={(e) => setF({ ...f, check_out: e.target.value })} /></Field>
        </div>
      )}
      <Field label="ملاحظة"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}
