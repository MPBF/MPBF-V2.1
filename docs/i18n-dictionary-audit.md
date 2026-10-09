# English dictionary audit

Run `npm run i18n:check` for coverage and merge diagnostics. Run the focused
regressions with:

```sh
npm test -- --runTestsByPath tests/i18n.test.ts tests/i18n-dictionary-audit.test.ts --roots tests
```

In a resource-constrained workspace, a runtime-only run can avoid ts-jest's
whole-project type analysis without changing project configuration:

```sh
npm test -- --runTestsByPath tests/i18n.test.ts tests/i18n-dictionary-audit.test.ts --roots tests --transform='{"^.+\\.tsx?$": ["ts-jest", {"useESM": true, "isolatedModules": true}]}'
```

That option is supported by the installed ts-jest 29, but deprecated for a
future major. It does not replace TypeScript checking. Restricting Jest roots
also avoids collisions between packages in installed skill directories.

The audit discovers every `client/src/i18n-en*.ts` dictionary, follows the
imported spreads in the actual `i18n.ts` `init()` English resource, and uses
their existing order to determine the effective values. Discovery alone does
not count toward coverage. An unmerged dictionary, an empty or Arabic English
value (including a hidden losing value), or an unreviewed differing override
fails the check. Identical duplicate values are harmless.

Diagnostics include the key, both source locations and both conflicting values.
Unsupported dynamic exports, nonliteral entries or resource construction fail
explicitly rather than reporting misleading coverage. If the dictionary
structure changes, extend the audit and its fixtures together.

## Existing reviewed override

The current order is production, reviewed, order workspace, then base English.
There is one differing override: `بحث في` changes from `Search` in the reviewed
dictionary to `Search in` in the base dictionary. Preserve that current winner;
this task does not authorize changing UI text or runtime merge priorities.

`scripts/i18n-reviewed-overrides.json` records the exact key, source files,
losing/winning values and rationale. Only add an exception after reviewing
the actual conflict. A changed value, reversed priority or obsolete exception
fails the check and needs re-review. Do not use key-only or wildcard exceptions.

## Runtime tests

Tests discover all dictionaries, compare their real exports and the complete
i18next English resource against the audit, pin the current merge priorities,
and verify every dictionary entry in both languages. Literal lookups disable
namespace parsing so punctuation in a label remains part of its key.

This intentionally does not change the application's default namespace
separator. Default lookups of some single-word colon labels can still be blank;
that existing UI behavior requires a separate correction and rendering tests.