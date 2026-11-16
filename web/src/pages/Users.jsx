import { useState } from 'react';
import { api } from '../api.js';
import { useData, useAction, useApp, Modal, Field, Loading, PageHead, ROLE_LABELS } from '../lib.jsx';
import { Plus } from 'lucide-react';

export default function Users() {
  const { user } = useApp();
  const { data, loading, reload } = useData('/users');
  const [edit, setEdit] = useState(null);
  const isAdmin = user.role === 'admin';

  if (loading) return <Loading />;
  return (
    <div>
      <PageHead title="المستخدمون والصلاحيات">
        {isAdmin && <button className="btn btn-primary" onClick={() => setEdit({ role: 'waiter' })}><Plus size={18} /> مستخدم</button>}
      </PageHead>
      {!isAdmin && <div className="alert alert-warn">إضافة المستخدمين وتعديلهم متاحة للمدير العام فقط.</div>}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th /></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'row-muted'}>
                <td><strong>{u.name}</strong></td>
                <td dir="ltr">{u.username}</td>
                <td><span className="badge">{ROLE_LABELS[u.role]}</span></td>
                <td>{u.active ? 'فعّال' : 'معطّل'}</td>
                <td>{isAdmin && <button className="btn btn-sm" onClick={() => setEdit(u)}>تعديل</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <UserForm u={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function UserForm({ u, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: u.name || '', username: u.username || '', password: '', role: u.role, active: u.active ?? 1 });
  const save = async () => {
    const body = u.id ? { name: f.name, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}) } : f;
    const ok = await run(() => (u.id ? api(`/users/${u.id}`, { method: 'PUT', body }) : api('/users', { method: 'POST', body })), 'تم الحفظ');
    if (ok) onSaved();
  };
  return (
    <Modal title={u.id ? 'تعديل مستخدم' : 'مستخدم جديد'} onClose={onClose} footer={<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>}>
      <div className="grid-2">
        <Field label="الاسم"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="اسم المستخدم"><input dir="ltr" value={f.username} disabled={!!u.id} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" /></Field>
        <Field label={u.id ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور'}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="الدور">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {u.id && <label className="switch"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> الحساب فعّال</label>}
    </Modal>
  );
}
