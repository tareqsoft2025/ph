# واجهة البرمجة (REST API)

كل المسارات تبدأ بـ `/api`. كل الطلبات (عدا تسجيل الدخول والفحص) تحتاج الترويسة:

```
Authorization: Bearer <token>
```

الأخطاء تُرجع بالشكل `{ "error": "رسالة" }` مع رمز الحالة المناسب (400، 401، 403، 404).

## الأدوار

| الدور | الرمز |
|---|---|
| المدير العام (كل الصلاحيات) | `admin` |
| مدير الفرع | `manager` |
| كاشير | `cashier` |
| نادل | `waiter` |
| المطبخ | `kitchen` |

## المسارات

| الطريقة | المسار | الأدوار | الوصف |
|---|---|---|---|
| GET | `/health` | الكل | فحص الخادم |
| POST | `/auth/login` | الكل | `{username, password}` ← `{token, user}` |
| GET | `/auth/me` | مسجّل | المستخدم الحالي |
| GET/PUT | `/settings` | قراءة: الكل، تعديل: manager | إعدادات المطعم والضريبة والرسوم |
| GET | `/users` | manager | قائمة المستخدمين |
| POST/PUT | `/users[/:id]` | admin | إضافة وتعديل مستخدم |
| GET | `/menu` | مسجّل | الفئات والأصناف مع الإضافات |
| POST/PUT/DELETE | `/categories[/:id]` | manager | إدارة الفئات |
| GET | `/items/:id` | manager | صنف مع الوصفة والتكلفة |
| POST/PUT/DELETE | `/items[/:id]` | manager | إدارة الأصناف (`modifiers[]` و `recipe[]`) |
| PATCH | `/items/:id/availability` | manager, kitchen, cashier | `{available}` إيقاف/تفعيل صنف |
| GET | `/tables` | مسجّل | الطاولات مع حالتها والطلب المفتوح |
| POST/PUT/DELETE | `/tables[/:id]` | manager | إدارة الطاولات |
| GET | `/orders?status=&type=&date=&from=&to=` | مسجّل | قائمة الطلبات |
| GET | `/orders/:id` | مسجّل | طلب مع الأصناف والدفعات |
| POST | `/orders` | cashier, waiter | إنشاء طلب (انظر المثال أدناه) |
| POST | `/orders/:id/items` | cashier, waiter | `{items[], send}` إضافة أصناف |
| PATCH | `/orders/:id/items/:lineId` | cashier, waiter | `{qty, notes}` أو `{cancel: true}` |
| POST | `/orders/:id/send` | cashier, waiter | إرسال الأصناف الجديدة للمطبخ |
| POST | `/orders/:id/serve` | cashier, waiter | تعليم الأصناف الجاهزة كمقدّمة |
| POST | `/orders/:id/discount` | cashier | `{type: "percent" or "amount", value}` |
| POST | `/orders/:id/move` | cashier, waiter | `{table_id}` نقل الطاولة |
| POST | `/orders/:id/pay` | cashier | `{payments: [{method, amount}]}` ← `{change, closed, order}` |
| POST | `/orders/:id/cancel` | cashier | `{reason}` |
| GET | `/kitchen?station=` | kitchen, waiter, cashier | الطلبات قيد التحضير مجمّعة |
| PATCH | `/kitchen/items/:id` | kitchen | `{status: new, preparing, ready or served}` |
| POST | `/kitchen/orders/:id/bump` | kitchen | `{status: preparing or ready}` لكل الطلب |
| GET/POST/PUT/DELETE | `/ingredients[/:id]` | manager (القراءة: kitchen أيضاً) | المواد الخام |
| POST | `/stock-movements` | manager, kitchen | `{ingredient_id, type: purchase, waste or adjust, qty, unit_cost, note}` |
| GET | `/stock-movements` | manager | سجل الحركات |
| GET | `/shifts/current` | مسجّل | الوردية المفتوحة وملخصها |
| GET | `/shifts` | manager | سجل الورديات |
| POST | `/shifts/open` | cashier | `{opening_cash}` |
| POST | `/shifts/close` | cashier | `{closing_cash, notes}` ← الملخص والفرق |
| GET | `/reservations?date=` | مسجّل | حجوزات اليوم |
| POST/PUT | `/reservations[/:id]` | cashier, waiter | إدارة الحجوزات |
| GET | `/customers?q=` | مسجّل | العملاء ونقاطهم |
| GET | `/reports/summary?from=&to=` | manager | ملخص التقارير |
| GET | `/audit` | admin | سجل التدقيق |

### مثال: إنشاء طلب صالة وإرساله للمطبخ

```json
POST /api/orders
{
  "type": "dine_in",
  "table_id": 3,
  "guests": 2,
  "send": true,
  "items": [
    { "item_id": 7, "qty": 2, "modifier_ids": [1], "notes": "بدون بصل" }
  ]
}
```

## الأحداث اللحظية (Socket.io)

الاتصال يتطلب `auth: { token }`. يرسل الخادم هذه الأحداث لتحديث الشاشات:

| الحدث | متى يُرسل |
|---|---|
| `orders` | إنشاء طلب أو تعديله أو دفعه |
| `kitchen` | إرسال أصناف للمطبخ أو تغيّر حالتها |
| `tables` | تغيّر حالة الطاولات |
| `menu` | تعديل قائمة الطعام أو توفر صنف |
| `inventory` | حركة مخزون |
| `shift` | فتح وردية أو إغلاقها |
| `reservations` | تعديل الحجوزات |
| `settings` | تعديل الإعدادات |

## حساب الفاتورة

```
المجموع    = Σ (سعر الصنف + الإضافات) × الكمية   (بدون الأصناف الملغاة)
الخصم      = نسبة من المجموع أو مبلغ ثابت
الخدمة     = (المجموع − الخصم) × نسبة الخدمة       (طلبات الصالة فقط)
التوصيل    = رسوم ثابتة                               (طلبات التوصيل فقط)
الضريبة    = (المجموع − الخصم + الخدمة + التوصيل) × نسبة الضريبة
الإجمالي   = المجموع − الخصم + الخدمة + التوصيل + الضريبة
```

إذا فُعّل خيار "الأسعار شاملة الضريبة" تُستخرج الضريبة من الإجمالي بدلاً من إضافتها.
