import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useData, useAction, useApp, has, Modal, Field, Loading, PageHead, ROLE_LABELS } from '../lib.jsx';
import { Plus, KeyRound } from 'lucide-react';

export default function Users() {
  const { user } = useApp();
  const { data, loading, reload } = useData('/users');
  const [edit, setEdit] = useState(null);
  const [permsFor, setPermsFor] = useState(null);
  const isAdmin = has(user, 'users.manage');
  const isSuper = user.role === 'admin';

  if (loading) return <Loading />;
  return (
    <div>
      <PageHead title="المستخدمون والصلاحيات">
        {isAdmin && <button className="btn btn-primary" onClick={() => setEdit({ role: 'waiter' })}><Plus size={18} /> مستخدم</button>}
      </PageHead>
      {!isAdmin && <div className="alert alert-warn">ليس لديك صلاحية إضافة المستخدمين أو تعديلهم.</div>}
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
                <td className="row gap-s">{isAdmin && (isSuper || u.role !== 'admin') && <button className="btn btn-sm" onClick={() => setEdit(u)}>تعديل</button>}{isAdmin && u.role !== 'admin' && <button className="btn btn-sm" onClick={() => setPermsFor(u)} title="تخصيص صلاحيات هذا المستخدم"><KeyRound size={15} aria-hidden /> الصلاحيات</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {permsFor && <UserPerms u={permsFor} onClose={() => setPermsFor(null)} onSaved={() => setPermsFor(null)} />}
      {edit && <UserForm u={edit} allowAdmin={isSuper} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function UserForm({ u, allowAdmin, onClose, onSaved }) {
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
            {Object.entries(ROLE_LABELS).filter(([k]) => allowAdmin || k !== 'admin').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {u.id && <label className="switch"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} /> الحساب فعّال</label>}
    </Modal>
  );
}

/** تخصيص صلاحيات مستخدم بعينه فوق صلاحيات دوره: منح صلاحية إضافية أو سحب صلاحية من دوره */
function UserPerms({ u, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [run, busy] = useAction();
  useEffect(() => { api(`/users/${u.id}/permissions`).then((d) => { setData(d); setDraft(new Set(d.effective)); }); }, [u.id]);
  const groups = useMemo(() => {
    const g = new Map();
    (data?.permissions || []).forEach((p) => { if (!g.has(p.group)) g.set(p.group, []); g.get(p.group).push(p); });
    return [...g.entries()];
  }, [data]);
  if (!data) return <Modal title={`صلاحيات ${u.name}`} onClose={onClose}><Loading /></Modal>;
  const base = new Set(data.role_perms);
  const toggle = (k) => setDraft((d) => { const n = new Set(d); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const grants = [...draft].filter((k) => !base.has(k));
  const denies = [...base].filter((k) => !draft.has(k));
  const save = async () => { if (await run(() => api(`/users/${u.id}/permissions`, { method: 'PUT', body: { grants, denies } }), 'تم حفظ صلاحيات المستخدم')) onSaved(); };
  const reset = async () => { if (await run(() => api(`/users/${u.id}/permissions`, { method: 'PUT', body: { reset: true } }), `عادت صلاحيات ${u.name} إلى صلاحيات دوره`)) onSaved(); };
  return (
    <Modal title={`صلاحيات ${u.name} · ${ROLE_LABELS[u.role]}`} onClose={onClose} footer={<><button className="btn" onClick={reset} disabled={busy}>الرجوع لصلاحيات الدور</button><button className="btn btn-primary" onClick={save} disabled={busy}>حفظ{grants.length + denies.length ? ` (${grants.length + denies.length} تخصيص)` : ''}</button></>}>
      <p className="muted small">الأصل صلاحيات دور «{ROLE_LABELS[u.role]}». فعّل أي صلاحية إضافية لهذا المستخدم وحده أو ألغِ صلاحية من صلاحيات دوره؛ التخصيصات تظهر بعلامة.</p>
      {groups.map(([g, list]) => (
        <fieldset key={g} className="up-group">
          <legend>{g}</legend>
          {list.map((p) => {
            const on = draft.has(p.key); const inRole = base.has(p.key);
            return (
              <label key={p.key} className="switch up-row">
                <input type="checkbox" checked={on} onChange={() => toggle(p.key)} />
                <span>{p.label}</span>
                {on && !inRole && <em className="badge badge-ok">ممنوحة له</em>}
                {!on && inRole && <em className="badge badge-warn">مسحوبة منه</em>}
              </label>
            );
          })}
        </fieldset>
      ))}
    </Modal>
  );
}
