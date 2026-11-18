import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Headset, Phone, MessageCircle, Send, X, PartyPopper, Sparkles, ArrowLeft } from 'lucide-react';
import { api, watchChat } from '../api.js';

const safe = (f, d = null) => { try { return f(); } catch { return d; } };
const deviceId = () => { let d = safe(() => localStorage.getItem('ph-co-device')); if (!d) { d = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); safe(() => localStorage.setItem('ph-co-device', d)); } return d; };
const hm = (s) => String(s || '').slice(11, 16);
const waLink = (p) => { const s = String(p || '').trim(); return /^(\+|00)/.test(s) ? `https://wa.me/${s.replace(/\D/g, '').replace(/^00/, '')}` : null; };

/**
 * ترحيب المؤسسة عند مسح QR + مركز خدمة العملاء (اتصال، واتساب، محادثة مباشرة مع الإشعارات)
 */
export default function SupportHub({ cfg, token }) {
  const ev = cfg.event;
  const phone = ev.support_phone || cfg.phone || '';
  const chatOn = !!ev.support_chat;
  const seenKey = `ph-chat-seen-${String(token).slice(0, 10)}`;
  const welKey = `ph-welcome-${String(token).slice(0, 10)}`;
  const [welcome, setWelcome] = useState(() => !safe(() => sessionStorage.getItem(welKey)));
  const [panel, setPanel] = useState(null);                // null | 'help'
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [seen, setSeen] = useState(() => Number(safe(() => localStorage.getItem(seenKey), 0)) || 0);
  const end = useRef(null);
  const dev = deviceId();
  const name = safe(() => localStorage.getItem('ph-co-name'), '') || '';

  const load = useCallback(() => {
    if (!chatOn) return;
    api(`/public/event/${token}/chat?device_id=${encodeURIComponent(dev)}`).then((r) => setMsgs(r.messages || [])).catch(() => {});
  }, [token, dev, chatOn]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    const off = chatOn ? watchChat(token, dev, load) : () => {};
    return () => { clearInterval(t); off(); };
  }, [load, token, dev, chatOn]);

  const lastStaff = [...msgs].reverse().find((m) => m.sender === 'staff')?.id || 0;
  const unread = lastStaff > seen && panel !== 'help';
  useEffect(() => {
    if (panel === 'help' && lastStaff > seen) { setSeen(lastStaff); safe(() => localStorage.setItem(seenKey, String(lastStaff))); }
    if (panel === 'help') end.current?.scrollIntoView({ block: 'end' });
  }, [panel, lastStaff, msgs.length]); // eslint-disable-line

  const closeWelcome = () => { safe(() => sessionStorage.setItem(welKey, '1')); setWelcome(false); };
  const openHelp = () => { closeWelcome(); setPanel('help'); };
  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api(`/public/event/${token}/chat`, { method: 'POST', body: { device_id: dev, name, body } });
      setMsgs(r.messages || []); setText('');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const wa = waLink(phone);
  const greeting = ev.welcome_message || `أهلاً بكم في ${ev.name}، نتمنى لكم قضاء أجمل الأوقات`;

  const Contacts = () => (
    <div className="sh-actions">
      {phone && <a className="sh-act" href={`tel:${phone.replace(/\s/g, '')}`}><Phone size={18} aria-hidden /><span>اتصال بخدمة العملاء<small dir="ltr">{phone}</small></span></a>}
      {wa && <a className="sh-act" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden /><span>واتساب<small>مراسلة مباشرة</small></span></a>}
      {chatOn && <button className="sh-act primary" onClick={openHelp}><Headset size={18} aria-hidden /><span>محادثة مباشرة<small>نرد عليك هنا فوراً</small></span></button>}
    </div>
  );

  return (
    <>
      {(phone || chatOn) && (
        <button className="co-help" onClick={() => setPanel('help')} aria-label="خدمة العملاء">
          <Headset size={20} aria-hidden />{unread && <i className="co-help-dot" aria-hidden />}
        </button>
      )}

      {welcome && createPortal(
        <div className="sh-welcome" role="dialog" aria-modal="true" aria-label="ترحيب">
          <div className="sh-confetti" aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</div>
          <div className="sh-card">
            <span className="sh-badge" aria-hidden><PartyPopper size={34} strokeWidth={1.6} /></span>
            <p className="sh-kicker"><Sparkles size={13} aria-hidden /> أهلاً وسهلاً</p>
            <h1>{ev.name}</h1>
            <p className="sh-msg">{greeting}</p>
            {!ev.welcome_message && <p className="sh-sub">يسعدنا خدمتكم في {cfg.name || 'المطعم'}. اختاروا ما يحلو لكم من قائمتكم الخاصة.</p>}
            <button className="btn btn-primary btn-lg btn-block" onClick={closeWelcome}>ابدأ الطلب <ArrowLeft size={18} aria-hidden /></button>
            {(phone || chatOn) && <><p className="sh-help-title">تحتاج مساعدة؟ خدمة العملاء بخدمتك</p><Contacts /></>}
          </div>
        </div>, document.body)}

      {panel === 'help' && createPortal(
        <div className="co-sheet-wrap" onClick={() => setPanel(null)}>
          <section className="co-sheet sh-sheet" role="dialog" aria-modal="true" aria-label="خدمة العملاء" onClick={(e) => e.stopPropagation()}>
            <header><h2><Headset size={19} aria-hidden /> خدمة العملاء</h2><button className="icon-btn" onClick={() => setPanel(null)} aria-label="إغلاق"><X size={20} /></button></header>
            {(phone || wa) && <div className="sh-top">{phone && <a className="btn btn-sm" href={`tel:${phone.replace(/\s/g, '')}`}><Phone size={15} aria-hidden /> <bdi dir="ltr">{phone}</bdi></a>}{wa && <a className="btn btn-sm" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden /> واتساب</a>}</div>}
            {chatOn ? (
              <>
                <div className="sh-msgs" aria-live="polite">
                  {!msgs.length && <div className="sh-empty"><Headset size={30} aria-hidden /><strong>كيف نخدمك؟</strong><small>اكتب استفسارك أو طلبك وسيرد عليك فريقنا هنا مباشرة.</small></div>}
                  {msgs.map((m) => <div key={m.id} className={`bub ${m.sender}`}><p>{m.body}</p><small>{m.sender === 'staff' ? `${cfg.name || 'المطعم'} · ` : ''}{hm(m.created_at)}</small></div>)}
                  <div ref={end} />
                </div>
                {err && <div className="alert alert-err" style={{ margin: '0 var(--s-4)' }}>{err}</div>}
                <form className="sh-compose" onSubmit={send}>
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك…" maxLength={500} aria-label="رسالتك" />
                  <button className="btn btn-primary" disabled={busy || !text.trim()} aria-label="إرسال"><Send size={18} /></button>
                </form>
              </>
            ) : <div className="sh-empty"><Contacts /></div>}
          </section>
        </div>, document.body)}
    </>
  );
}
