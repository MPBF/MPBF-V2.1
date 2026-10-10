# Unit-based finished-goods receiving

The user confirmed both calculation methods and the exact units:
«الوحدات تكون (كيلو-باكت-رول-قطعة)».

## Hall and receipt

The production hall remains kilogram-based: cumulative ready output minus
all receipts. It includes partially manufactured orders without closing
manufacturing through receiving.

Selecting orders and choosing receive opens one voucher with numbered,
prefilled lines. Each line displays its order and available kg, storage
location, unit, unit count and packing calculation. An order may have multiple
lines with different units or packing specifications. All lines are committed
atomically after validating the combined weight against current ready stock.

Units are exactly kg, packet, roll and piece. Non-kg counts are positive
integers. Kg counts allow hundredths and represent kilograms directly.

- Unit weight: unit count × weight per unit in kg.
- Piece weight: unit count × pieces per unit × piece weight in grams ÷ 1000.
- Calculations use shared exact integer arithmetic, rounded to the existing
  stock precision of 0.01 kg. The server recalculates, never trusting a
  submitted equivalent weight.

## Storage and compatibility

Keep the existing kilogram stock and movement ledger for conservation.
Add unit balances partitioned by inventory/order/location and normalized
packing specification. Different units or weights never merge into one count.
Save line numbers and full packing snapshots on new receipt lines.

Historical receipts and balances remain unchanged. Previously unknown units
are displayed as historical kg-only stock; do not guess counts or weights.
Preserve legacy receipt compatibility, authorization, sorted order locks,
transaction rollback and request-key idempotency.

Apply a narrow additive migration to development only. Production deployment,
shipping, unit conversions of historical stock and new raw flows are outside
this request.

## Verification

Test exact conversion and validation, mixed-unit/partial receipts,
same-unit different weights, historical preservation, simultaneous receiving,
lost responses, permissions and atomic rollback. Exercise both languages at
phone/tablet/desktop widths with isolated browser fixtures and disposable SQL.
