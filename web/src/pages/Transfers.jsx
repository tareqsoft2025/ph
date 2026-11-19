import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Landmark, Smartphone, Wallet, CircleCheckBig, CircleAlert, CircleX, Hourglass, ListChecks, FileSpreadsheet, Download, Search, RotateCcw, ShieldCheck, TriangleAlert,
} from 'lucide-react';
import { api } from '../api.js';
import { useData, useAction, useMoney, Modal, Field, Empty, Loading, PageHead, PAY_METHODS, TRANSFER_METHODS } from '../lib.jsx';

const ICON = { wallet: Wallet, bank: Landmark, jawwalpay: Smartphone };
const STATUS = {
  pending: ['بانتظار التدقيق', 'warn', Hourglass],
  confirmed: ['وصل المبلغ', 'ok', CircleCheckBig],
  mismatch: ['فرق في المبلغ', 'err', CircleAlert],
  rejected: ['لم يصل', 'err', CircleX],
};
const TABS = [['open', 'بانتظار التدقيق'], ['confirmed', 'مؤكدة'], ['rejected', 'لم تصل'], ['', 'الكل']];
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const when = (s) => String(s || '').slice(5, 16).replace('-', '/');

/** تدقيق التحويلات: التأكد من وصول مبالغ المحافظ والبنك وجوال بي إلى الحسابات مقابل كشف الحساب */
export default function Transfers() {
  const money = useMoney();
  const [tab, setTab] = useState('open');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(dstr(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState('');
  const qs = useMemo(() => new URLSearchParams({ ...(tab ? { status: tab } : {}), ...(method ? { method } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString(), [tab, method, from, to, q]);
  const { data, loading, reload } = useData(`/transfers?${qs}`, ['transfers', 'orders'], []);
  const [confirmFor, setConfirmFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [stmt, setStmt] = useState(false);
  const [run, busy] = useAction();

  // الإحصاءات لكل الحالات (بنفس الفترة والطريقة) بدل الحالة المختارة
  const all = useData(`/transfers?${new URLSearchParams({ ...(method ? { method } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`, ['transfers', 'orders'], []);
  const by = Object.fromEntries((all.data?.by_status || []).map((s) => [s.k, s]));
  const n = (k) => by[k]?.n || 0;
  const t = (k) => by[k]?.total || 0;

  const reopen = async (r) => { if (await run(() => api(`/transfers/${r.id}/reopen`, { method: 'POST' }), 'أُعيد التحويل للانتظار')) { reload(); all.reload(); } };
  const done = () => { setConfirmFor(null); setRejectFor(null); reload(); all.reload(); };

  const exportCsv = () => {
    const head = ['التاريخ', 'الطلب', 'الطريقة', 'المحوِّل', 'الجوال', 'المرجع', 'المبلغ', 'الواصل', 'الحالة', 'المحصِّل', 'المدقِّق', 'ملاحظة'];
    const rows = (data?.rows || []).map((r) => [r.created_at, r.code, PAY_METHODS[r.method], r.payer_name || r.customer_name || '', r.payer_phone || '', r.reference || '', r.amount, r.received_amount ?? '', STATUS[r.status]?.[0] || '', r.cashier_name || '', r.verifier_name || '', r.verify_note || '']);
    const csv = [head, ...rows].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `transfers-${dstr(new Date())}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const rows = data?.rows || [];
  return (
    <div className="trf">
      <PageHead title="تدقيق التحويلات" sub="تأكد من وصول ما حوّله الزبائن عبر المحافظ والبنك وجوال بي إلى حساباتكم، وطابقه مع كشف الحساب">
        <button className="btn" onClick={exportCsv} disabled={!rows.length}><Download size={16} /> تصدير</button>
        <button className="btn btn-primary" onClick={() => setStmt(true)}><FileSpreadsheet size={17} /> مطابقة كشف الحساب</button>
      </PageHead>

      <div className="trf-kpis">
        <button className={`trf-kpi k-warn ${tab === 'open' ? 'on' : ''}`} onClick={() => setTab('open')}><Hourglass size={18} aria-hidden /><span>بانتظار التدقيق</span><strong>{n('pending') + n('mismatch')}</strong><small>{money(t('pending') + t('mismatch'))}</small></button>
        <button className={`trf-kpi k-ok ${tab === 'confirmed' ? 'on' : ''}`} onClick={() => setTab('confirmed')}><CircleCheckBig size={18} aria-hidden /><span>وصلت وأُكّدت</span><strong>{n('confirmed')}</strong><small>{money(t('confirmed'))}</small></button>
        <button className={`trf-kpi k-err ${tab === 'rejected' ? 'on' : ''}`} onClick={() => setTab('rejected')}><CircleX size={18} aria-hidden /><span>لم تصل</span><strong>{n('rejected')}</strong><small>{money(t('rejected'))}</small></button>
        <div className="trf-kpi k-info"><ShieldCheck size={18} aria-hidden /><span>فرق في المبلغ</span><strong>{n('mismatch')}</strong><small>{n('mismatch') ? 'تحتاج مراجعة' : 'لا يوجد'}</small></div>
      </div>

      <div className="trf-bar">
        <div className="seg" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="طريقة التحويل">
          <option value="">كل الطرق</option>
          {TRANSFER_METHODS.map((m) => <option key={m} value={m}>{PAY_METHODS[m]}</option>)}
        </select>
        <label className="trf-date"><span>من</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="trf-date"><span>إلى</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="search-box"><Search size={16} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم الطلب، المرجع، الاسم، الجوال…" aria-label="بحث" /></span>
      </div>

      {loading && !data ? <Loading /> : !rows.length ? (
        <Empty icon={ListChecks} text={tab === 'open' ? 'لا توجد تحويلات بانتظار التدقيق. تظهر هنا فور تسجيل الكاشير تحويلاً.' : 'لا توجد تحويلات مطابقة'} />
      ) : (
        <div className="table-wrap">
          <table className="data trf-table">
            <thead><tr><th>التاريخ</th><th>الطلب</th><th>المحوِّل</th><th>الطريقة</th><th>المرجع</th><th>المبلغ</th><th>الحالة</th><th>المحصِّل</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const [sl, sc, SI] = STATUS[r.status] || ['', '', Hourglass];
                const MI = ICON[r.method] || Wallet;
                const diff = r.status === 'mismatch' ? Math.round((r.received_amount - r.amount) * 100) / 100 : 0;
                return (
                  <tr key={r.id} className={`trf-row s-${r.status}`}>
                    <td className="muted">{when(r.created_at)}</td>
                    <td><Link to={`/pos/${r.order_id}`} className="order-code" dir="ltr">{r.code}</Link>{(r.table_name || r.event_name) && <small className="muted"> · {r.event_name || r.table_name}</small>}</td>
                    <td><strong>{r.payer_name || r.customer_name || '—'}</strong>{r.payer_phone && <small className="muted" dir="ltr"> {r.payer_phone}</small>}</td>
                    <td><span className="trf-method"><MI size={14} aria-hidden /> {PAY_METHODS[r.method]}</span></td>
                    <td dir="ltr" className="trf-ref">{r.reference || <em className="muted">بلا مرجع</em>}</td>
                    <td><strong>{money(r.amount)}</strong>{diff !== 0 && <small className="trf-diff"> واصل {money(r.received_amount)} ({diff > 0 ? '+' : ''}{money(diff)})</small>}</td>
                    <td>
                      <span className={`badge badge-${sc}`}><SI size={12} aria-hidden /> {sl}</span>
                      {r.verifier_name && <small className="muted trf-by"> {r.verifier_name} · {when(r.verified_at)}</small>}
                      {r.verify_note && <small className="muted trf-note">{r.verify_note}</small>}
                    </td>
                    <td className="muted">{r.cashier_name || '—'}</td>
                    <td>
                      <div className="trf-acts">{(r.status === 'pending' || r.status === 'mismatch') ? (
                        <>
                          <button className="btn btn-sm btn-ok" onClick={() => setConfirmFor(r)}><CircleCheckBig size={14} /> وصل</button>
                          <button className="btn btn-sm btn-danger-ghost" onClick={() => setRejectFor(r)}><CircleX size={14} /> لم يصل</button>
                        </>
                      ) : <button className="btn btn-sm btn-ghost" onClick={() => reopen(r)} disabled={busy} title="إعادة للانتظار"><RotateCcw size={14} /> تراجع</button>}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmFor && <ConfirmModal r={confirmFor} money={money} onClose={() => setConfirmFor(null)} onDone={done} />}
      {rejectFor && <RejectModal r={rejectFor} money={money} onClose={() => setRejectFor(null)} onDone={done} />}
      {stmt && <StatementModal money={money} onClose={() => setStmt(false)} onDone={() => { reload(); all.reload(); }} />}
    </div>
  );
}

function Brief({ r, money }) {
  return (
    <div className="trf-brief">
      <div><span>الطلب</span><strong dir="ltr">{r.code}</strong></div>
      <div><span>الطريقة</span><strong>{PAY_METHODS[r.method]}</strong></div>
      <div><span>المحوِّل</span><strong>{r.payer_name || r.customer_name || '—'}</strong></div>
      <div><span>المبلغ المسجَّل</span><strong>{money(r.amount)}</strong></div>
    </div>
  );
}

function ConfirmModal({ r, money, onClose, onDone }) {
  const [run, busy] = useAction();
  const [received, setReceived] = useState(String(r.received_amount ?? r.amount));
  const [reference, setReference] = useState(r.reference || '');
  const [note, setNote] = useState('');
  const diff = Math.round((Number(received) - r.amount) * 100) / 100;
  const save = async () => {
    const ok = await run(() => api(`/transfers/${r.id}/confirm`, { method: 'POST', body: { received_amount: Number(received), reference, note } }), diff === 0 ? 'تم تأكيد وصول التحويل' : 'سُجّل الفرق وبقي التحويل للمراجعة');
    if (ok) onDone();
  };
  return (
    <Modal title="تأكيد وصول التحويل" onClose={onClose} footer={<button className="btn btn-ok btn-lg" onClick={save} disabled={busy || received === ''}>{diff === 0 ? 'تأكيد الوصول' : 'تسجيل الفرق'}</button>}>
      <Brief r={r} money={money} />
      <p className="muted small">قارن التحويل مع كشف حساب المحفظة أو البنك ثم أدخل المبلغ الذي ظهر فعلاً.</p>
      <div className="grid-2">
        <Field label="المبلغ الواصل حسب الكشف"><input type="number" step="0.01" min="0" value={received} onChange={(e) => setReceived(e.target.value)} className="input-lg" autoFocus /></Field>
        <Field label="رقم العملية / المرجع"><input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} /></Field>
      </div>
      {diff !== 0 && <div className="alert alert-warn"><TriangleAlert size={15} aria-hidden /> الواصل {diff < 0 ? 'أقل' : 'أكثر'} من المسجَّل بـ {money(Math.abs(diff))}. سيُعلَّم التحويل «فرق في المبلغ» ويصل إشعار للإدارة.</div>}
      <Field label="ملاحظة (اختياري)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </Modal>
  );
}

function RejectModal({ r, money, onClose, onDone }) {
  const [run, busy] = useAction();
  const [note, setNote] = useState('');
  const save = async () => { if (await run(() => api(`/transfers/${r.id}/reject`, { method: 'POST', body: { note } }), 'سُجّل أن التحويل لم يصل')) onDone(); };
  return (
    <Modal title="التحويل لم يصل" onClose={onClose} footer={<button className="btn btn-danger" onClick={save} disabled={busy || !note.trim()}>تسجيل عدم الوصول</button>}>
      <Brief r={r} money={money} />
      <p className="muted small">سيصل إشعار للإدارة وللكاشير الذي سجّل التحويل لمتابعته مع الزبون.</p>
      <Field label="السبب" hint="مثال: لم يظهر في كشف المحفظة حتى نهاية اليوم"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoFocus /></Field>
    </Modal>
  );
}

/** أسطر الكشف: «مرجع، مبلغ» أو مبلغ فقط أو مرجع فقط */
function parseLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/[,;\t|،]+/).map((x) => x.trim()).filter(Boolean);
    const num = (s) => (/^[0-9][0-9.,]*$/.test(s) ? Number(s.replace(/,/g, '')) : null);
    if (parts.length >= 2) return { reference: parts[0], amount: num(parts[parts.length - 1]) };
    return num(parts[0]) != null ? { reference: '', amount: num(parts[0]) } : { reference: parts[0] || '', amount: null };
  });
}

function StatementModal({ money, onClose, onDone }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState(new Set());
  const [run, busy] = useAction();
  const lines = useMemo(() => parseLines(text), [text]);
  const match = async () => {
    const r = await run(() => api('/transfers/match', { method: 'POST', body: { lines } }));
    if (r) { setRes(r); setPick(new Set(r.matches.filter((m) => m.amount_ok && !m.self).map((m) => m.id))); }
  };
  const confirm = async () => {
    const r = await run(() => api('/transfers/confirm-batch', { method: 'POST', body: { ids: [...pick] } }));
    if (r) { window.alert(`تم تأكيد ${r.confirmed} تحويل${r.skipped ? ` (تخطّي ${r.skipped})` : ''}`); onDone(); onClose(); }
  };
  const toggle = (id) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal title="مطابقة كشف الحساب" wide onClose={onClose} footer={res
      ? <><button className="btn" onClick={() => setRes(null)}>تعديل الكشف</button><button className="btn btn-ok btn-lg" onClick={confirm} disabled={busy || !pick.size}>تأكيد المحدد ({pick.size})</button></>
      : <button className="btn btn-primary btn-lg" onClick={match} disabled={busy || !lines.length}>مطابقة {lines.length ? `(${lines.length} سطر)` : ''}</button>}>
      {!res ? (
        <>
          <p className="muted small">الصق أسطر كشف حساب المحفظة أو البنك، سطر لكل عملية بصيغة <b>مرجع، مبلغ</b> (أو المبلغ وحده). تُطابَق بالمرجع أولاً ثم بالمبلغ إن كان فريداً بين التحويلات المنتظرة.</p>
          <textarea className="trf-paste" rows={9} dir="ltr" value={text} onChange={(e) => setText(e.target.value)} placeholder={'TRX-1001, 45.00\nJP-77, 30\n120'} aria-label="أسطر الكشف" />
        </>
      ) : (
        <>
          <div className="trf-match-sum"><span className="badge badge-ok">{res.matches.length} مطابق</span><span className="badge badge-warn">{res.unmatched.length} غير مطابق</span></div>
          {res.matches.length > 0 && (
            <table className="data">
              <thead><tr><th /><th>الطلب</th><th>الطريقة</th><th>المرجع</th><th>المسجَّل</th><th>الكشف</th><th>المطابقة</th></tr></thead>
              <tbody>{res.matches.map((m) => (
                <tr key={m.id} className={m.amount_ok ? '' : 'row-warn'}>
                  <td><input type="checkbox" checked={pick.has(m.id)} onChange={() => toggle(m.id)} disabled={m.self} aria-label={`تحديد ${m.code}`} /></td>
                  <td dir="ltr">{m.code}</td><td>{PAY_METHODS[m.method]}</td><td dir="ltr">{m.reference || '—'}</td>
                  <td>{money(m.amount)}</td><td>{m.statement_amount != null ? money(m.statement_amount) : '—'}{!m.amount_ok && <small className="trf-diff"> ≠</small>}</td>
                  <td><small>{m.by === 'reference' ? 'بالمرجع' : 'بالمبلغ'}{m.self ? ' · سجّلته أنت' : ''}</small></td>
                </tr>))}</tbody>
            </table>
          )}
          {res.unmatched.length > 0 && (
            <div className="trf-unmatched"><h4>أسطر لم تُطابَق</h4>
              <ul>{res.unmatched.map((u) => <li key={u.line}><bdi dir="ltr">{u.reference || '—'}</bdi> · {u.amount != null ? money(u.amount) : 'بلا مبلغ'}</li>)}</ul>
              <p className="muted small">قد تكون تحويلات لم تُسجَّل في النظام أو مكررة؛ راجعها يدوياً.</p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
