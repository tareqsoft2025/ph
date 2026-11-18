import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageCircle, Send, Building2, ArrowRight, UserRound } from 'lucide-react';
import { api } from '../api.js';
import { useData, useAction, Empty, Loading, PageHead } from '../lib.jsx';

const hm = (s) => String(s || '').slice(11, 16);
const day = (s) => String(s || '').slice(5, 10).replace('-', '/');

/** صندوق محادثات زبائن المؤسسات: قائمة المحادثات + المحادثة المفتوحة */
export default function Chat() {
  const [params, setParams] = useSearchParams();
  const sel = params.get('e') && params.get('d') ? { e: Number(params.get('e')), d: params.get('d') } : null;
  const threads = useData('/chat/threads', ['chat'], []);
  const rows = threads.data || [];
  const open = (t) => setParams({ e: String(t.event_id), d: t.device_id });
  const unreadAll = rows.reduce((a, t) => a + (t.unread || 0), 0);

  return (
    <div className={`chat-page ${sel ? 'has-sel' : ''}`}>
      <PageHead title="محادثات الزبائن" sub={unreadAll ? `${unreadAll} رسالة جديدة بانتظار الرد` : 'رسائل موظفي المؤسسات وزبائنها عبر صفحة QR'} />
      <div className="chat-grid">
        <aside className="chat-list" aria-label="المحادثات">
          {threads.loading && !threads.data ? <Loading /> : !rows.length ? <Empty icon={MessageCircle} text="لا توجد محادثات بعد. تظهر هنا رسائل الزبائن لحظة وصولها." /> : rows.map((t) => (
            <button key={`${t.event_id}:${t.device_id}`} className={`chat-item ${sel && sel.e === t.event_id && sel.d === t.device_id ? 'on' : ''} ${t.unread ? 'unread' : ''}`} onClick={() => open(t)}>
              <span className="chat-av" aria-hidden><UserRound size={18} /></span>
              <span className="chat-item-body">
                <strong>{t.customer_name || 'زبون'}</strong>
                <small><Building2 size={11} aria-hidden /> {t.event_name}</small>
                <span className="chat-last">{t.last_sender === 'staff' ? 'أنت: ' : ''}{t.last_body}</span>
              </span>
              <span className="chat-meta"><time>{hm(t.last_at)}</time>{t.unread > 0 && <b>{t.unread}</b>}</span>
            </button>
          ))}
        </aside>
        <section className="chat-pane">
          {sel ? <Thread key={`${sel.e}:${sel.d}`} sel={sel} onBack={() => setParams({})} onChanged={threads.reload} /> : <Empty icon={MessageCircle} text="اختر محادثة للرد على الزبون" />}
        </section>
      </div>
    </div>
  );
}

function Thread({ sel, onBack, onChanged }) {
  const q = useData(`/chat/thread?event_id=${sel.e}&device_id=${encodeURIComponent(sel.d)}`, ['chat'], [sel.e, sel.d]);
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const end = useRef(null);
  const msgs = q.data?.messages || [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  useEffect(() => { if (q.data) onChanged?.(); }, [q.data?.messages?.length]); // eslint-disable-line

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    const r = await run(() => api('/chat/reply', { method: 'POST', body: { event_id: sel.e, device_id: sel.d, body } }));
    if (r) { setText(''); q.reload(); }
  };
  const lastCustomer = [...msgs].reverse().find((m) => m.sender === 'customer');

  return (
    <>
      <header className="chat-head">
        <button className="icon-btn chat-back" onClick={onBack} aria-label="رجوع"><ArrowRight size={20} /></button>
        <span className="chat-av" aria-hidden><UserRound size={18} /></span>
        <div><strong>{lastCustomer?.name || 'زبون'}</strong><small>{q.data?.event?.name}</small></div>
      </header>
      <div className="chat-msgs" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={m.id} className={`bub ${m.sender}`}>
            {i === 0 || day(msgs[i - 1].created_at) !== day(m.created_at) ? <span className="bub-day">{day(m.created_at)}</span> : null}
            <p>{m.body}</p>
            <small>{m.sender === 'staff' ? `${m.staff_name || 'المطعم'} · ` : ''}{hm(m.created_at)}</small>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="chat-compose" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب ردك للزبون…" maxLength={500} aria-label="الرد" autoFocus />
        <button className="btn btn-primary" disabled={busy || !text.trim()}><Send size={17} /> إرسال</button>
      </form>
    </>
  );
}
