---
name: i18n duplicate translation blocks
description: ar.json/en.json contain duplicate sibling keys (e.g. two warehouse.print blocks); only the LAST wins, so edit the right one.
---

Some namespaces in `client/src/i18n/locales/ar.json` and `en.json` have the SAME key declared twice as siblings (notably `warehouse.print` appears twice, and `warehouse.tabs`-area keys repeat). JSON.parse keeps the **last** occurrence, so i18next only sees the second/last block.

**Why:** New translation keys added to the FIRST block silently never resolve at runtime — `t()` returns the key string instead. This wastes debugging time because the file looks correct.

**How to apply:** Before adding a key, grep for the parent block (e.g. `rg -n '"print": {' client/src/i18n/locales/ar.json`) and add to the LAST match. After editing, verify with `node -e "JSON.parse(fs.readFileSync(...))"` and read back the resolved value via the nested path. The winning `warehouse.print` block already holds factoryName/printVoucher/warehouseKeeper/receiver/manager plus the voucher print labels.
