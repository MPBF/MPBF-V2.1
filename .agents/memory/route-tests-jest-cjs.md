---
name: Route integration tests under ts-jest
description: How to test server/routes/* handlers in jest without the shared.ts CJS transpile crash
---
Testing an Express route module (server/routes/*.ts) in jest crashes with
`Cannot access 'multer_1' before initialization` because `server/routes/shared.ts`
has top-level code before its own imports; ts-jest transpiles to CJS where
requires run in source order.

**Why:** ESM at runtime hoists imports, so dev works; only CJS-transpiled jest breaks.

**How to apply:** In the test, `jest.mock("../server/routes/shared", ...)` exporting
only what the route needs (e.g. `notificationManagerHolder: { manager: null }`),
and also mock `../server/services/notification-manager` and `../server/storage`
if unused — otherwise background monitors keep handles open and jest hangs
without --forceExit. `^multer$` is also mapped to tests/__mocks__/multer.cjs.
Pattern for auth: an express middleware that sets req.user from an
`x-test-user` header, then register the real route module and hit it via fetch
on `app.listen(0)`.
