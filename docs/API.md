# واجهة البرمجة (REST API)

كل المسارات تبدأ بـ `/api`. كل الطلبات (عدا تسجيل الدخول والفحص) تحتاج الترويسة:

```
Authorization: Bearer <token>
```

الأخطاء تُرجع بالشكل `{ "error": "رسالة" }` مع رمز الحالة المناسب (400، 401، 403، 404).

## الأدوار والصلاحيات

كل مسار يتطلب صلاحية (مثل `pos.create` و`payments.collect` و`kitchen.update`). صلاحيات الأدوار قابلة للتخصيص من صفحة **الصلاحيات**، وقائمتها الكاملة في `backend/src/perms.js`. المدير العام (`admin`) يملك كل الصلاحيات.

### الأدوار

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
| GET | `/orders/:id` | مسجّل | طلب مع الأصناف والدفعات وتسلسل العملية `events` |
| GET | `/payments/history?from=&to=&method=&q=&user_id=` | payments.collect / payments.view_all | سجل التحصيلات: الكاشير يرى تحصيلاته فقط، ومن يملك `payments.view_all` يرى الجميع مع اسم المحصّل وملخص حسب الطريقة والموظف |
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
| GET | `/notifications` | مسجّل | آخر 50 إشعاراً وعدد غير المقروء |
| POST | `/notifications/read` | مسجّل | `{ids?}` تعليم كمقروء (بدون ids = الكل) |
| DELETE | `/notifications` | مسجّل | حذف المقروءة |
| GET | `/push/status` | مسجّل | `{enabled, devices}` هل Firebase مفعّل على الخادم وعدد أجهزتي |
| POST | `/push/register` | مسجّل | `{token, platform}` تسجيل رمز الجهاز للإشعارات الفورية |
| POST | `/push/unregister` | مسجّل | `{token}` إلغاء تسجيل الجهاز |
| POST | `/push/test` | مسجّل | إرسال إشعار تجريبي لي |
| GET | `/audit?user_id=&category=&from=&to=&q=&before=` | activity.view | سجل الحركات مع اسم المستخدم وكود الطلب، وترقيم الصفحات `{rows, more}` |
| POST | `/orders/:id/request-bill` | pos.create | النادل يطلب الحساب، فيُشعَر الكاشير |
| GET | `/permissions` | admin | كل الصلاحيات وصلاحيات كل دور |
| PUT | `/permissions/:role` | admin | `{perms: []}` أو `{reset: true}` |
| GET | `/employees?status=active\|terminated\|all` | manager | الموظفون مع حالة اليوم وتنبيهات المستندات |
| GET | `/employees/:id?month=YYYY-MM` | manager | ملف الموظف: المستندات، الحضور، الإجازات، الملخص الشهري |
| POST/PUT | `/employees[/:id]` | manager | إضافة وتعديل موظف |
| POST | `/employees/:id/status` | manager | `{status: active\|terminated}` |
| POST | `/employees/:id/documents` | manager | `{title, doc_type, number, expiry_date, file_name, file_type, file_data}` (data URL حتى 2.5MB) |
| GET | `/documents/:id/file` | manager | محتوى الملف المرفق |
| DELETE | `/documents/:id` | manager | حذف مستند |
| GET | `/hr/alerts` | manager | المستندات والعقود القريبة من الانتهاء، وطلبات الإجازة المعلّقة |
| GET | `/attendance/me` | مسجّل | حضوري اليوم وملخص الشهر وقواعد التسجيل (المواقع، ربط الجهاز) ووقت الخادم |
| POST | `/attendance/challenge` | مسجّل | رمز لمرة واحدة صالح 120 ثانية `{nonce}` |
| POST | `/attendance/check-in` و `/attendance/check-out` | مسجّل (مرتبط بموظف) | `{nonce, lat, lng, accuracy, age_ms, device_id, platform, mock, emulator, rooted}`، وعند الرفض يعيد `{error, reason, nearest}` |
| GET/POST/PUT/DELETE | `/work-locations[/:id]` | hr.attendance | مواقع الحضور `{name, lat, lng, radius_m}` |
| GET | `/attendance/report?from=&to=&employee_id=` | hr.attendance | تقرير الحضور: لكل موظف ويومي، والمحاولات المرفوضة والسجلات المعلّمة |
| POST | `/employees/:id/reset-device` | hr.attendance | إلغاء ربط جهاز الموظف |
| POST | `/employees/:id/account` | hr.employees | `{username, password}` إنشاء حساب بدور "موظف" |
| GET | `/attendance?date=` | manager | الكشف اليومي |
| POST | `/attendance` | manager | تسجيل يدوي `{employee_id, date, status, check_in, check_out, note}` |
| GET | `/attendance/summary?month=` | manager | الملخص الشهري لكل الموظفين |
| GET/POST | `/leaves` | مسجّل | الموظف يرى طلباته ويطلب، والمدير يرى الكل ويضيف |
| PATCH | `/leaves/:id` | manager | `{status: approved\|rejected}` |
| GET | `/payroll?month=` | manager | مسير الرواتب |
| POST/DELETE | `/payroll/adjustments[/:id]` | manager | `{employee_id, month, type: bonus\|deduction\|advance, amount, note}` |

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
| `hr` | تعديل الموظفين أو المستندات أو الإجازات أو الرواتب |
| `attendance` | تسجيل حضور أو انصراف |
| `notify` | إشعار جديد `{user_ids, type, title, body, link, level}` (يعرضه المستخدمون المستهدفون فقط) |

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


## الطلب من رمز QR الطاولة (بلا تسجيل دخول)
لا يوجد رابط عام للطلب: لكل طاولة رمز عشوائي (96 بت) خاص بها يُطبع في بطاقة QR، ولا يصلح إلا لتلك الطاولة. يمكن تغيير رمز أي طاولة (تبطل البطاقة القديمة) ويمكن إيقاف الخدمة كلها من الإعدادات (`online_ordering`). عند الإيقاف تُرجع مسارات القائمة والطلب 403.

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/public/table/:token` | بيانات الطاولة وحالتها وإن كانت الخدمة مفعّلة |
| GET | `/public/table/:token/menu` | المنيو المتاح للزبون (بدون بيانات داخلية) |
| POST | `/public/table/:token/orders` | إنشاء طلب (`guests`, `customer_name`, `customer_phone`, `notes`, `items[]`) ويُرسل للمطبخ فوراً؛ يرجع `code` و`token` للمتابعة. وإن كانت الطاولة عليها طلب من الرمز نفسه يمكن الإضافة عليه بإرسال `order_token`. محدود المعدل |
| GET | `/public/orders/:code?t=token` | متابعة حالة الطلب للزبون |
| GET | `/tables/qr` | (settings.manage) رموز الطاولات لطباعة البطاقات |
| POST | `/tables/:id/qr/rotate` | (settings.manage) تغيير رمز طاولة |

رابط البطاقة: `<عنوان الموقع>/#/t/<token>`.
