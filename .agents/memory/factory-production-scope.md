---
name: Factory production scope
description: Approved business boundaries for per-roll execution, partial receipts, and future extensions.
---

Deleting a customer order from the Orders page is an explicitly approved
permanent cascade through its production orders, rolls, receipts and associated
inventory. Shared receipts retain other orders' items. This does not authorize
removing protections on standalone production-order edits or deletion.

**Why:** the user specifically requested complete removal of production data
when deleting the parent order.

**How to apply:** keep existing deletion permissions, warn before deletion,
perform cleanup atomically, and preserve unrelated orders and receipt items.

Manufacturing completion and warehouse receipt are separate business events.
Receiving all currently ready output must not close film or finish manufacturing.
Film can close below the planned target through an explicitly selected last
roll. A positive roll that reaches or exceeds the planned target must be
accepted at its full actual weight and automatically treated as the last roll,
closing film. Manufacturing completion still waits for required downstream work.

**Why:** the user approved per-roll progression and partial receiving during
ongoing film production, not a sequential whole-order pipeline. They later
explicitly required accepting a quantity above the requested amount and treating
that roll as the last roll.

**How to apply:** preserve these distinctions when adding labels, reports,
scheduling, or warehouse extensions.

المستودع صفحة رئيسية مستقلة تضم «صالة الإنتاج» و«مخزن المواد التامة».
These are warehouse tabs, not production/operator tabs.

**Why:** the user explicitly requested a new main Warehouse page and moving
both tabs out of Production.

**How to apply:** preserve the existing receiving/inventory permissions and
business behavior, including private roll links and independent partial
receipts. Do not grant warehouse access merely through an operational stage or
general production permission.

Future-stage queue planning must remain possible while film production is
still open, even if there are no currently eligible rolls for that stage.

**Why:** the user explicitly required retaining this existing business rule
when preventing completed printing from being queued again.

**How to apply:** distinguish advance planning during open film from
downstream queue eligibility after film closes; do not turn queue assignment
into an implicit film closure or rewrite historical production.

Rolls in the film, printing and cutting operator boards should appear beside
one another in wrapping cards, rather than one full-width row per roll.

**Why:** the user requested conserving page height across all three boards.

**How to apply:** preserve per-production-order grouping and roll actions; show
multiple columns where readable on phone/tablet/desktop and use one column only
on very narrow screens.

The user requested extending Warehouse to four halls: raw materials,
production, finished goods and delivery, each with incoming/outgoing vouchers.
Raw materials receive from suppliers and supply production; production holds
work in progress and cleared cutting quantities with completion indicators;
finished goods receive output and hold it until customer delivery.

**Why:** the user explicitly expanded the previous finished-goods-only scope.

**How to apply:** preserve historical balances and vouchers while designing
the interconnected flows. This does not authorize changing the published
database without separate approval.

Raw-material mixing belongs in a new Production and Operation tab visible
to film operators. Record actual quantities of each material, the mixer
operator, time and destination machine. Mixed quantities deduct from raw
inventory, with negative raw balances allowed.

**Why:** the user explicitly requested actual mixing records and negative
raw balances so stock constraints do not prevent recording mixes.

**How to apply:** do not block mixing for insufficient raw stock; do not
infer that finished-goods or delivery balances may also become negative.
Mixing directly deducts raw inventory without creating a raw issue voucher
or a corresponding production-hall receipt voucher.

**Why:** the user explicitly corrected the design: «لا يحتاج ربط الخلطة
بسند صرف خام وسند إدخال مقابل».

**How to apply:** retain the mixing record as the traceable source of its
stock deduction; keep independent hall vouchers separate from mixing.

All warehouse and mixing material identities must be selected from predefined
items; raw selections must be items in the raw category. Do not introduce
free-form material definitions in operational screens.

**Why:** the user corrected the separate raw-material editor: «ويتم اختيار
المواد من قائمة وليس ادخال حر وهي الاصناف التي من فئة خام المعرفة مسبقا»
and «لا اريد اي ادخال حر لاي من المواد او الخام».

**How to apply:** keep quantities editable, but select material identities from
the existing catalogue and validate raw eligibility on the server as well.
Show hall contents as cards; the production hall shows actual cut quantities
immediately, including incomplete production orders. The raw hall has separate
«إدخال مواد خام» and «صرف مواد خام» actions.
Industrial hardware integration, automatic scheduling and public roll
sharing still require separate approval.

Order release is a focused transition to ready for production, not a general
status editor or automatic manufacturing start.

**Why:** the user selected «زر تحويل للإنتاج في القائمة والتفاصيل» rather than
adding a status selector to the order-edit form, after approving a readiness-only
transition.

**How to apply:** keep both entry points and preserve explicit production start;
do not broaden the action into arbitrary historical-order reopening.

Released, untouched production plans appear as ready in film operation, but
the worker starts execution explicitly.

**Why:** the user selected «يظهر جاهزاً في الفيلم، والعامل يبدأه».

**How to apply:** do not hide eligible pending work just because execution
has not started; do not auto-start on release or create rolls or receipts
when starting. Historical, stopped and cancelled work is not new ready work.

Automatic film duration is one aggregate per production order and machine:
the time between its first and last recorded rolls, not a duration per roll.

**Why:** the user explicitly corrected «لا اريد حساب مدة كل رول اريد حساب
المدة فقط من اول رول الى اخر رول فقط» and selected «لكل أمر إنتاج على كل
ماكينة».

**How to apply:** do not substitute adjacent-roll durations, sum manual minutes,
or combine different orders/machines. Remove manual duration entry without
rewriting historical records.

لا تحذف تاريخاً أو تغير قاعدة الإنتاج المنشورة دون موافقة مستقلة.

**Why:** the user explicitly required this boundary when approving archive
performance work; optimization is not permission to discard factory history
or migrate the published database.

**How to apply:** use disposable local databases for volume benchmarks.
Any published-database change needs separate approval.

Each roll must record who created it, printed it and cut it. Per-roll receiver
tracking is explicitly out of scope.

**Why:** the user requested the production actors, then corrected the receipt
scope: «عفوا لا اريد تحديد من استلم الرول».

**How to apply:** preserve the three actual production actors. Do not add
receiver selection, per-roll receipt allocation or warehouse workflow changes
under this request.

The film-board final-roll checkbox label must be only «آخر رول», without adding
an adjacent closure explanation.

**Why:** the user explicitly requested «خيار اخر رول قم بتعديل النص بجانبه
ليكون فقط اخر رول».

**How to apply:** keep this short label while preserving the existing final-roll
closure behavior; do not restore longer explanatory checkbox text unasked.

The film operator must not have the duplicate “Close film with existing rolls”
button.

**Why:** the user requested «الغاء زر اغلاق الفيلم باستخدام الرولات المسجلة
لانه مكرر».

**How to apply:** remove that operator-board button without inferring permission
to remove the final-roll closure workflow or unrelated backend capabilities.

Do not show the film-duration summary on the film operator board; retain its
data and its display in records.

**Why:** the user said «لا اريد ظهور مدة الانتاج ... في لوحة تشغيل الفيلم
اريد فقط حفظها بالسجلات».

**How to apply:** hide the entire duration block there, including machine,
recorded-roll count and first/last timestamps; do not remove recording,
calculation or historical review.

Film operators always use phones, and must handle many customer orders with
multiple production orders.

**Why:** the user said «التعامل مع الصفحة من قبل العمال سيكون باستخدام
الهاتف دائما» and «وجود طلبات كثيرة واوامر انتاج عديدة».

**How to apply:** prioritize phone readability, short operational labels and
touch-friendly controls; group production orders by their customer order.
The film-board focus is size, raw material, film color and thickness, not
customer/production status or stage badges.

Only one customer-order group should be open at a time on the film board.

**Why:** the user selected «طلب واحد مفتوح (موصى به)» instead of showing
all customer-order groups expanded.

**How to apply:** preserve this phone-oriented disclosure preference when
changing the film board; do not expand all requests by default.
