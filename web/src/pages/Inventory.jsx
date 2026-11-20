import { useState } from 'react';
import { LayoutDashboard, Boxes, PackagePlus, PackageMinus, Trash, CalendarX2, ClipboardCheck, Truck } from 'lucide-react';
import { useApp, useData, has, PageHead, useMoney } from '../lib.jsx';
import Overview from '../inventory/Overview.jsx';
import Stock from '../inventory/Stock.jsx';
import Flow from '../inventory/Flow.jsx';
import { Expiry, Stocktake, Suppliers } from '../inventory/Panels.jsx';
import { ReceiveForm, MoveForm, IngredientForm, MaterialDrawer } from '../inventory/forms.jsx';

const TABS = [
  ['overview', 'نظرة عامة', LayoutDashboard], ['stock', 'الأرصدة', Boxes], ['in', 'وارد', PackagePlus], ['out', 'صادر', PackageMinus],
  ['waste', 'التالف', Trash], ['expiry', 'الصلاحية', CalendarX2], ['take', 'الجرد', ClipboardCheck, 'manage'], ['suppliers', 'الموردون', Truck],
];

/** المخازن: مركز إدارة المخزون — وارد، صادر، تالف، صلاحيات، جرد وموردون */
export default function Inventory() {
  const money = useMoney();
  const { user } = useApp();
  const canManage = has(user, 'inventory.manage');
  const canRecv = has(user, 'inventory.receive', 'inventory.manage');
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('ph-inv-tab') || 'overview'; } catch { return 'overview'; } });
  const ings = useData('/ingredients', ['inventory']);
  const sup = useData('/suppliers', ['inventory']);
  const ov = useData('/inventory/overview', ['inventory']);
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(null);       // { kind, ing, preset }
  const go = (t) => { setTab(t); try { localStorage.setItem('ph-inv-tab', t); } catch { /* */ } };
  const list = ings.data || [];
  const act = (kind, ing, preset) => setForm({ kind, ing, preset });
  const afterSave = () => { setForm(null); ings.reload(); sup.reload(); ov.reload(); };
  const value = ov.data?.kpis?.value;
  const visible = TABS.filter((t) => !t[3] || canManage);

  return (
    <div className="inv">
      <PageHead title="المخازن" sub={value != null ? `قيمة المخزون ${money(value)} · ${list.length} مادة` : 'إدارة المخزون'}>
        {canRecv && <button className="btn btn-primary" onClick={() => act('receive')}><PackagePlus size={17} /> استلام بضاعة</button>}
        {canRecv && <button className="btn" onClick={() => act('issue')}><PackageMinus size={17} /> صرف</button>}
        {canRecv && <button className="btn btn-danger-ghost" onClick={() => act('waste')}><Trash size={17} /> تالف</button>}
      </PageHead>

      <nav className="inv-tabs" role="tablist" aria-label="أقسام المخازن">
        {visible.map(([k, l, Icon]) => <button key={k} role="tab" aria-selected={tab === k} className={`${tab === k ? 'on' : ''} t-${k}`} onClick={() => go(k)}><Icon size={16} aria-hidden /> {l}</button>)}
      </nav>

      {tab === 'overview' && <Overview canRecv={canRecv} onGo={go} onReceive={(preset) => act('receive', null, preset)} />}
      {tab === 'stock' && <Stock canManage={canManage} canRecv={canRecv} onOpen={setDrawer} onAction={act} onNew={() => act('edit', {})} />}
      {(tab === 'in' || tab === 'out' || tab === 'waste') && <Flow key={tab} kind={tab} canRecv={canRecv} onAdd={(k) => act(k)} />}
      {tab === 'expiry' && <Expiry canRecv={canRecv} />}
      {tab === 'take' && canManage && <Stocktake onDone={afterSave} />}
      {tab === 'suppliers' && <Suppliers canManage={canManage} />}

      {drawer && <MaterialDrawer id={drawer} canManage={canManage} canRecv={canRecv} onClose={() => setDrawer(null)} onAction={(k, ing) => { if (!k) { ings.reload(); ov.reload(); return; } act(k, ing); }} />}
      {form?.kind === 'receive' && <ReceiveForm ingredients={list} suppliers={sup.data || []} preset={{ ...form.preset, ing: form.ing }} onClose={() => setForm(null)} onSaved={afterSave} />}
      {['issue', 'waste', 'return', 'adjust'].includes(form?.kind) && <MoveForm type={form.kind} ing={form.ing} ingredients={list} onClose={() => setForm(null)} onSaved={afterSave} />}
      {form?.kind === 'edit' && <IngredientForm ing={form.ing || {}} suppliers={sup.data || []} categories={ov.data?.categories || []} onClose={() => setForm(null)} onSaved={afterSave} />}
    </div>
  );
}
