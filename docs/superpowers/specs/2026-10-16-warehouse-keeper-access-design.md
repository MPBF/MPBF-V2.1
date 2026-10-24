# Warehouse keeper access

User-approved scope: the warehouse keeper may access only User Dashboard and
Warehouse, including direct URLs and administrator role previews. Preserve all
warehouse receiving, raw-material movements, finished inventory and delivery work.
Do not change other roles, account identities or inventory records.

Correct the selected saved role, removing general production/report grants while
retaining legacy warehouse grants and adding the current module's six grants.
Use effective permissions for both navigation and the direct-route guard; do not
identify administrators by role ID or use their original authority during preview.
Preserve old warehouse bookmarks and private roll QR links. Existing server
authorization must reject manufacturing and unrelated business actions.

Apply the targeted, row-locked role correction only in development. Verify pure
policies, backend permission denial, preview restoration, responsive navigation,
warehouse forms, direct URLs, type checking and the production build.
