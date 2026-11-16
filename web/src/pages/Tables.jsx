import { useNavigate } from 'react-router-dom';
import { useData, useMoney, useNow, minutesSince, Loading, Empty, PageHead } from '../lib.jsx';
import { UserRound, Clock, CalendarDays } from 'lucide-react';

export default function Tables() {
  const navigate = useNavigate();
  const money = useMoney();
  const { data, loading } = useData('/tables', ['tables', 'orders']);
  useNow();

  if (loading) return <Loading />;
  if (!data?.length) return <Empty text="لا توجد طاولات، أضفها من الإعدادات" />;

  const areas = [...new Set(data.map((t) => t.area))];
  const counts = { free: 0, occupied: 0, reserved: 0 };
  data.forEach((t) => counts[t.status]++);

  return (
    <div>
      <PageHead title="الطاولات">
        <span className="legend"><i className="dot free" /> فارغة {counts.free}</span>
        <span className="legend"><i className="dot occupied" /> مشغولة {counts.occupied}</span>
        <span className="legend"><i className="dot reserved" /> محجوزة {counts.reserved}</span>
      </PageHead>
      {areas.map((area) => (
        <section key={area} className="area">
          <h2 className="area-title">{area}</h2>
          <div className="tables-grid">
            {data.filter((t) => t.area === area).map((t) => (
              <button key={t.id} className={`table-card t-${t.status}`}
                onClick={() => navigate(t.order_id ? `/pos/${t.order_id}` : `/pos?type=dine_in&table=${t.id}`)}>
                <div className="t-name">{t.name}</div>
                <div className="t-seats"><UserRound size={14} aria-hidden /> {t.guests || t.seats}</div>
                {t.order_id ? (
                  <>
                    <div className="t-total">{money(t.order_total)}</div>
                    <div className="t-time"><Clock size={13} aria-hidden /> {minutesSince(t.opened_at)} د · #{t.order_number}</div>
                    {t.ready_items > 0 && <span className="badge badge-ok pulse">جاهز {t.ready_items}</span>}
                  </>
                ) : t.reservation ? (
                  <div className="t-res"><CalendarDays size={13} aria-hidden /> {t.reservation}</div>
                ) : (
                  <div className="t-avail">متاحة</div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
