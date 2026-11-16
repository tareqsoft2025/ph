import { useState } from 'react';
import { api } from '../api.js';
import { useAction, useData, Modal, Field, WEEKDAYS, ROLE_LABELS } from '../lib.jsx';

/** نموذج إضافة / تعديل موظف */
export default function EmployeeForm({ emp = {}, onClose, onSaved }) {
  const [run, busy] = useAction();
  const users = useData('/users');
  const [f, setF] = useState({
    name: emp.name || '', job_title: emp.job_title || '', department: emp.department || '',
    phone: emp.phone || '', email: emp.email || '', national_id: emp.national_id || '', nationality: emp.nationality || '',
    birth_date: emp.birth_date || '', address: emp.address || '',
    hire_date: emp.hire_date || new Date().toISOString().slice(0, 10), contract_end: emp.contract_end || '',
    basic_salary: emp.basic_salary ?? '', allowances: emp.allowances ?? 0,
    work_start: emp.work_start || '09:00', work_end: emp.work_end || '17:00',
    weekly_off: String(emp.weekly_off ?? '5').split(',').filter((x) => x !== '').map(Number),
    annual_leave_days: emp.annual_leave_days ?? 21,
    emergency_contact: emp.emergency_contact || '', bank_iban: emp.bank_iban || '', notes: emp.notes || '',
    user_id: emp.user_id || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleDay = (d) => setF({ ...f, weekly_off: f.weekly_off.includes(d) ? f.weekly_off.filter((x) => x !== d) : [...f.weekly_off, d].sort() });

  async function save() {
    const body = { ...f, user_id: f.user_id || null, basic_salary: Number(f.basic_salary) || 0, allowances: Number(f.allowances) || 0 };
    for (const k of ['birth_date', 'contract_end', 'hire_date']) if (!body[k]) body[k] = null;
    const r = await run(() => (emp.id ? api(`/employees/${emp.id}`, { method: 'PUT', body }) : api('/employees', { method: 'POST', body })), 'تم حفظ بيانات الموظف');
    if (r) onSaved(emp.id || r.id);
  }

  return (
    <Modal wide title={emp.id ? `تعديل: ${emp.name}` : 'موظف جديد'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !f.name.trim()}>حفظ</button>
      </>
    }>
      <h4 className="section-title first">البيانات الشخصية</h4>
      <div className="grid-2">
        <Field label="الاسم الكامل"><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="الجوال"><input dir="ltr" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="رقم الهوية / الإقامة"><input dir="ltr" value={f.national_id} onChange={set('national_id')} /></Field>
        <Field label="الجنسية"><input value={f.nationality} onChange={set('nationality')} /></Field>
        <Field label="تاريخ الميلاد"><input type="date" value={f.birth_date} onChange={set('birth_date')} /></Field>
        <Field label="البريد الإلكتروني"><input dir="ltr" type="email" value={f.email} onChange={set('email')} /></Field>
      </div>
      <Field label="العنوان"><input value={f.address} onChange={set('address')} /></Field>
      <Field label="جهة اتصال للطوارئ"><input value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="الاسم والرقم" /></Field>

      <h4 className="section-title">بيانات العمل</h4>
      <div className="grid-2">
        <Field label="المسمى الوظيفي"><input value={f.job_title} onChange={set('job_title')} /></Field>
        <Field label="القسم"><input value={f.department} onChange={set('department')} placeholder="المطبخ، الصالة…" /></Field>
        <Field label="تاريخ التعيين"><input type="date" value={f.hire_date} onChange={set('hire_date')} /></Field>
        <Field label="نهاية العقد"><input type="date" value={f.contract_end} onChange={set('contract_end')} /></Field>
        <Field label="بداية الدوام"><input type="time" value={f.work_start} onChange={set('work_start')} /></Field>
        <Field label="نهاية الدوام"><input type="time" value={f.work_end} onChange={set('work_end')} /></Field>
      </div>
      <Field label="أيام الراحة الأسبوعية">
        <div className="day-picker">
          {WEEKDAYS.map((d, i) => (
            <button type="button" key={d} className={`chip ${f.weekly_off.includes(i) ? 'chip-on' : ''}`} aria-pressed={f.weekly_off.includes(i)} onClick={() => toggleDay(i)}>{d}</button>
          ))}
        </div>
      </Field>
      <Field label="حساب الدخول للنظام" hint="يسمح للموظف بتسجيل حضوره وطلب الإجازات من حسابه">
        <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: Number(e.target.value) || '' })}>
          <option value="">— بدون حساب —</option>
          {(users.data || []).filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name} (@{u.username} · {ROLE_LABELS[u.role]})</option>)}
        </select>
      </Field>

      <h4 className="section-title">الراتب</h4>
      <div className="grid-2">
        <Field label="الراتب الأساسي"><input type="number" min="0" value={f.basic_salary} onChange={set('basic_salary')} /></Field>
        <Field label="البدلات"><input type="number" min="0" value={f.allowances} onChange={set('allowances')} /></Field>
        <Field label="رصيد الإجازة السنوية (يوم)"><input type="number" min="0" value={f.annual_leave_days} onChange={set('annual_leave_days')} /></Field>
        <Field label="رقم الآيبان"><input dir="ltr" value={f.bank_iban} onChange={set('bank_iban')} placeholder="SA…" /></Field>
      </div>
      <Field label="ملاحظات"><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}
