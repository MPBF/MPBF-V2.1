# Automatic film duration by production order and machine

## Approved direction

The user explicitly rejected per-roll duration and selected one aggregate
duration for each production order on each film machine:
last recorded roll time minus first recorded roll time.
Remove manual duration entry. Do not assign elapsed time to individual rolls.

## Calculation

- Group by production-order ID and film-machine ID, not by customer order,
  calendar day, operator, shift or the currently selected machine.
- Use the earliest and latest stored roll creation timestamps from the full
  source, including rolls already printed, cut, completed or received.
- Preserve elapsed time across midnight and include gaps/stops between records.
  This is a recording span, not verified machine-running time.
- With no rolls, no duration exists. With one roll, show “one roll; duration
  not yet determined.” With at least two rolls, calculate the nonnegative
  difference and display whole seconds as hours/minutes/seconds as appropriate.
  Two rolls with the same timestamp legitimately have a zero-second span.
- Do not use production start, film closure, current time or manual minutes
  as substitutes for either endpoint.

## Backend

Add a typed film-machine duration summary with machine ID, roll count, first
timestamp, last timestamp and nullable duration seconds.
Production-order records returned by live state and order history include
an array of these summaries. The individual roll-detail response includes
the corresponding order/machine summary, explicitly not a per-roll duration.

Calculate the summaries in read-only queries using indexed production-order
lookups and grouped MIN/MAX over all relevant rolls. Do not calculate from
limited work feeds or history-page records. Avoid adding a per-roll aggregate
to every roll-history row. Keep existing authorization and read consistency.

Remove production_minutes from the film-create request schema/type and from
the insertion values. The strict HTTP boundary rejects attempts to submit it;
direct service callers cannot cause a manual duration to be saved.
Existing persisted manual minutes and timestamps remain unchanged. No database
schema migration, production database change or historical rewrite is needed.

## UI

Remove the film operator's minutes input, draft state and outgoing value.
Show the automatic order/machine summaries in the film card and shared
production-order facts, including historical order review. A roll detail
shows its order's aggregate span on that roll's film machine instead of the
old individual manual duration.

Label the value “Production duration — first to last roll” in Arabic and English,
identify the machine, and show first/last timestamps so the basis is clear.
Use existing machine names, date/number formatting and responsive components.
Missing summary data must not be replaced with a guessed duration.
Do not change roll labels, order print sheets, stock receiving or stage actions.

## Verification

Verify multiple rolls, multiple orders/machines, one/no rolls, equal timestamps,
cross-midnight spans, completed rolls, full-source history and strict rejection
of manual minutes. Assert old saved minutes/timestamps remain unchanged.
Use disposable database fixtures and intercepted browser APIs for writes.
Check Arabic/English at phone/tablet/desktop widths, actual recording payloads,
roll detail, historical review, retry behavior, types and existing production
regressions.
