import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RotateCcw, Save, ShieldCheck, Check } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useAction, Loading, Empty, PageHead, ROLE_LABELS } from '../lib.jsx';

/** مصفوفة الصلاحيات: لكل دور مجموعة صلاحيات قابلة للتخصيص */
export default function Permissions() {
  const { user } = useApp();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [run, busy] = useAction();

  const load = async () => {
    const d = await api('/permissions');
    setData(d);
    setDraft(Object.fromEntries(d.roles.map((r) => [r.role, new Set(r.perms)])));
  };
  useEffect(() => { if (user.role === 'admin') load().catch(() => {}); }, [user.role]);

  const groups = useMemo(() => {
    const g = new Map();
    (data?.permissions || []).forEach((p) => { if (!g.has(p.group)) g.set(p.group, []); g.get(p.group).push(p); });
    return [...g.entries()];
  }, [data]);

  if (user.role !== 'admin') return <Empty icon={ShieldCheck} text="تعديل الصلاحيات متاح للمدير العام فقط" />;
  if (!data) return <Loading />;

  const dirty = (role) => {
    const orig = new Set(data.roles.find((r) => r.role === role).perms);
    const cur = draft[role];
    return cur.size !== orig.size || [...cur].some((k) => !orig.has(k));
  };
  const toggle = (role, key) => setDraft((d) => {
    const s = new Set(d[role]);
    if (s.has(key)) s.delete(key); else s.add(key);
    return { ...d, [role]: s };
  });
  const save = async (role) => {
    if (await run(() => api(`/permissions/${role}`, { method: 'PUT', body: { perms: [...draft[role]] } }), `تم حفظ صلاحيات ${ROLE_LABELS[role]}`)) load();
  };
  const reset = async (role) => {
    if (!window.confirm(`إعادة صلاحيات ${ROLE_LABELS[role]} إلى الافتراضي؟`)) return;
    if (await run(() => api(`/permissions/${role}`, { method: 'PUT', body: { reset: true } }), 'تمت الاستعادة')) load();
  };

  return (
    <div>
      <PageHead title="الصلاحيات" sub="حدّد ما يستطيع كل دور فعله. المدير العام يملك كل الصلاحيات دائماً، وتُطبّق التغييرات فوراً على كل الأجهزة." />
      <div className="perm-wrap">
        <table className="perm">
          <thead>
            <tr>
              <th className="perm-name"><KeyRound size={16} aria-hidden /> الصلاحية</th>
              {data.roles.map((r) => (
                <th key={r.role}>
                  <div className="perm-role">
                    <strong>{ROLE_LABELS[r.role]}</strong>
                    <span className="muted small">{draft[r.role]?.size} صلاحية{r.customized ? ' · مخصّصة' : ''}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(([group, perms]) => (
            <tbody key={group}>
              <tr className="perm-group"><th colSpan={data.roles.length + 1}>{group}</th></tr>
              {perms.map((p) => (
                <tr key={p.key}>
                  <th className="perm-name" scope="row">{p.label}</th>
                  {data.roles.map((r) => {
                    const on = draft[r.role]?.has(p.key);
                    const def = r.defaults.includes(p.key);
                    return (
                      <td key={r.role}>
                        <button
                          className={`perm-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on}
                          aria-label={`${p.label} — ${ROLE_LABELS[r.role]}`} title={def ? 'مفعّلة افتراضياً' : ''}
                          onClick={() => toggle(r.role, p.key)}
                        >
                          <span className="perm-knob">{on && <Check size={12} strokeWidth={3} />}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <th />
              {data.roles.map((r) => (
                <td key={r.role}>
                  <div className="perm-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => save(r.role)} disabled={busy || !dirty(r.role)}><Save size={15} /> حفظ</button>
                    {r.customized && <button className="btn btn-sm btn-ghost" onClick={() => reset(r.role)} disabled={busy}><RotateCcw size={15} /> افتراضي</button>}
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
