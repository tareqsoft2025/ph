import { Info, ListChecks } from 'lucide-react';

/** هل للوجبة تفصيل أو مكونات تستحق عرضها؟ */
export const hasDetail = (it) => !!(it?.details || it?.components?.length);

/** تفصيل الوجبة ومكوناتها (يُستعمل في نقطة البيع وصفحة الزبون) */
export default function DishDetail({ item, price, art }) {
  const img = /^(https?:|data:)/.test(art || '');
  return (
    <div className="dd">
      <div className="dd-head">
        <span className="dd-art" aria-hidden>{img ? <img src={art} alt="" /> : <span>{art || '🍽️'}</span>}</span>
        <div>
          <h3>{item.name}</h3>
          {item.description && <p className="dd-short">{item.description}</p>}
          {price && <b className="dd-price">{price}</b>}
        </div>
      </div>
      {item.details && <section><h4><Info size={14} aria-hidden /> عن الوجبة</h4><p className="dd-text">{item.details}</p></section>}
      {item.components?.length > 0 && (
        <section>
          <h4><ListChecks size={14} aria-hidden /> المكونات</h4>
          <ul className="dd-chips">{item.components.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
