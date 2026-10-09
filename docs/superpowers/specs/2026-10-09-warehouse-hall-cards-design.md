# Approved warehouse cards and catalogue-only materials

The user approved this design on 2026-10-09.

- Warehouse content is presented as responsive cards, not stock tables.
- The production hall aggregates actual ready net cutting output by production
  order, including partially processed orders; it shows ready, received,
  remaining quantities and manufacture completeness. Receipt remains separate
  from manufacture. Existing roll-product bypass behavior is preserved.
- The raw hall has two actions: predefined raw-material receipt and issue.
  Both select active items already defined under the raw category. Names,
  codes and other material definitions cannot be entered in operational forms.
- Mixing uses the same catalogue identities, deducts actual weights directly,
  still permits negative raw balances, and creates no paired vouchers.
- New raw receipt/issue vouchers atomically change stock and record the actor,
  server time, lines and signed audit entries. Reads and writes are permission
  scoped; viewers cannot post.
- Historical balances and mix references are retained. No inferred name-based
  remapping of legacy manually defined materials. Zero-stock catalogue links
  are provisioned automatically, without resetting existing stock.
- Writes use exact UUID/payload recovery on ambiguous outcomes; duplicates,
  unknown/non-raw/inactive materials and free-form payloads are rejected.
- Test real SQL concurrency/replay/rollback in an isolated database; verify
  Arabic/English layouts and behavior at phone/tablet/desktop sizes with
  isolated browser fixtures. Production database changes require separate
  approval.
