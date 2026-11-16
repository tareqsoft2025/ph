import { useApp, useMoney, Modal, ORDER_TYPES, PAY_METHODS } from '../lib.jsx';

/** معاينة الفاتورة وطباعتها (طابعة حرارية 80مم) */
export default function Receipt({ order, onClose }) {
  const { settings } = useApp();
  const money = useMoney();
  const items = order.items.filter((i) => i.status !== 'cancelled');
  return (
    <Modal title="الفاتورة" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>إغلاق</button>
        <button className="btn btn-primary" onClick={() => window.print()}>🖨️ طباعة</button>
      </>
    }>
      <div className="receipt" id="receipt">
        <div className="r-center">
          <strong className="r-title">{settings.restaurant_name}</strong>
          {settings.address && <div>{settings.address}</div>}
          {settings.phone && <div dir="ltr">{settings.phone}</div>}
          {settings.tax_number && <div>الرقم الضريبي: {settings.tax_number}</div>}
          <div className="r-sep" />
          <div>{order.status === 'paid' ? 'فاتورة ضريبية مبسطة' : 'فاتورة مبدئية'}</div>
          <div>طلب #{order.number} · {ORDER_TYPES[order.type]}{order.table_name ? ` · ${order.table_name}` : ''}</div>
          <div dir="ltr">{order.closed_at || order.created_at}</div>
        </div>
        <div className="r-sep" />
        <table className="r-items">
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.qty}×</td>
                <td>{i.name}{i.modifiers.length > 0 && <div className="r-mods">{i.modifiers.map((m) => m.name).join('، ')}</div>}</td>
                <td className="r-num">{money(i.price * i.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="r-sep" />
        <div className="r-row"><span>المجموع</span><span>{money(order.subtotal)}</span></div>
        {order.discount > 0 && <div className="r-row"><span>الخصم</span><span>− {money(order.discount)}</span></div>}
        {order.service > 0 && <div className="r-row"><span>الخدمة</span><span>{money(order.service)}</span></div>}
        {order.delivery_fee > 0 && <div className="r-row"><span>التوصيل</span><span>{money(order.delivery_fee)}</span></div>}
        <div className="r-row"><span>الضريبة ({settings.tax_rate}%)</span><span>{money(order.tax)}</span></div>
        <div className="r-row r-total"><span>الإجمالي</span><span>{money(order.total)}</span></div>
        {order.payments?.length > 0 && (
          <>
            <div className="r-sep" />
            {order.payments.map((p) => <div key={p.id} className="r-row"><span>{PAY_METHODS[p.method]}</span><span>{money(p.amount)}</span></div>)}
          </>
        )}
        <div className="r-sep" />
        <div className="r-center">{settings.receipt_footer}</div>
      </div>
    </Modal>
  );
}
