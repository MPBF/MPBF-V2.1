// Runs only against check-deferred-loading's isolated build/API fixture server.
const fs = require("node:fs/promises");
const path = require("node:path");
const postcss = require("postcss");

module.exports = async function checkThemeColors({ language, open, wait, evaluate, send, check }) {
  const registry = postcss.parse(await fs.readFile("client/src/styles/theme-tokens.css", "utf8"));
  const definitions = new Map();
  registry.walkDecls(declaration => definitions.set(declaration.prop, declaration.value));
  const publicName = "--theme-order-print-page-opp-toolbar-copy-strong-text";
  const compact = new Map([...definitions.keys()].filter(name => name.startsWith("--theme-"))
    .filter(name => name !== publicName).map((name, index) => [name, `--_t${index.toString(36)}`]));
  const output = path.resolve("generated-artifacts/theme-checks");
  await fs.mkdir(output, { recursive: true });
  const layoutFindings = [];
  const screenshot = async name => {
    await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element&&a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
    const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(path.join(output, `${language}-${name}.png`), Buffer.from(image.data, "base64"));
  };
  const inspect = async (name, selector, dialog = false) => {
    for (const width of [390, 768, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
      await evaluate("Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target instanceof Element&&a.effect.target.closest('[role=dialog]')).map(a=>a.finished))");
      const result = await evaluate(`(()=>{
        const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})];
        const node=nodes.find(n=>n.getBoundingClientRect().width>0);
        if(!node)return {visible:false};
        const bounds=node.getBoundingClientRect(),style=getComputedStyle(node);
        const missing=[];
        for(const sheet of document.styleSheets){
          let rules;try{rules=sheet.cssRules}catch{continue}
          const visit=rules=>{for(const rule of rules){
            if(rule.cssRules)visit(rule.cssRules);
            if(!rule.style)continue;
            for(const prop of rule.style){
              for(const match of rule.style.getPropertyValue(prop).matchAll(/var\\((--(?:_t[\\da-z]+|theme-[\\w-]+))/g)){
                if(!getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim())missing.push(match[1]);
              }
            }
          }};visit(rules);
        }
        return {visible:true,missing:[...new Set(missing)],color:style.color,
          fits:bounds.left>=-1&&bounds.right<=innerWidth+1,
          pageFits:document.documentElement.scrollWidth<=innerWidth+1,
          dialogFits:bounds.top>=-1&&bounds.bottom<=innerHeight+1,
          bounds:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom},
          viewport:{width:innerWidth,height:innerHeight},pageWidth:document.documentElement.scrollWidth};
      })()`);
      check(`${language} ${name} ${width}px visible`, result.visible);
      check(`${language} ${name} ${width}px resolves all central colors`, result.missing, []);
      if (result.fits && result.pageFits) check(`${language} ${name} ${width}px fits width`, true);
      else {
        layoutFindings.push({ language, name, width, result });
        console.warn(`LAYOUT FINDING ${language} ${name} ${width}px: ${JSON.stringify(result)}`);
      }
      if (dialog) check(`${language} ${name} ${width}px fits height`, result.dialogFits);
      await screenshot(`${name}-${width}`);
    }
    await send("Emulation.clearDeviceMetricsOverride");
  };
  for (const [route, selector, name] of [
    ["/", ".stats", "dashboard"],
    ["/orders", ".page-heading", "orders"],
    ["/customers", ".page-heading", "customers"],
    ["/my-dashboard", ".self-page", "personal-dashboard"],
    ["/hr", ".hr-tabs", "human-resources"],
    ["/planning", ".planning-page", "planning"],
    ["/production/film", ".production-app", "production"],
    ["/production/mixing", ".raw-ops", "mixing"],
    ["/production/monitoring", ".pm-page", "monitoring"],
    ["/warehouse/raw-materials", ".raw-ops", "raw-inventory"],
    ["/warehouse/hall", ".production-app", "warehouse-hall"],
    ["/warehouse/finished-inventory", ".finished-inventory-page", "finished-inventory"],
    ["/admin", ".users-table", "administration"],
  ]) {
    await open(route); await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    // The table intentionally switches to cards on phones.
    await inspect(name, name === "administration" ? ".content" : selector);
    if (name === "customers") {
      await evaluate("document.querySelector('.page-heading .btn-primary').click()");
      await wait("!!document.querySelector('.customer-modal')");
      await inspect("customer-dialog", ".customer-modal", true);
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      check(`${language} reduced motion still overrides lazy modal animation`,
        await evaluate("getComputedStyle(document.querySelector('.customer-modal')).animationDuration"), "1e-05s");
      await send("Emulation.setEmulatedMedia", { features: [] });
    }
    if (name === "orders") {
      await evaluate("document.querySelector('.page-heading .btn-primary').click()");
      await wait("!!document.querySelector('.order-create-modal')");
      await inspect("order-dialog", ".order-create-modal", true);
      await open("/orders"); await wait("!!document.querySelector('.order-status--new')");
      await evaluate(`document.querySelector('[aria-label=${JSON.stringify(language === "ar" ? "عرض الطلب" : "View order")}]').click()`);
      await wait("!!document.querySelector('.odm-summary-strip')");
      await inspect("order-details-dialog", ".odm-dialog", true);
    }
    if (name === "production") {
      const token = compact.get("--theme-production-production-prod-ink");
      check("production central token exists", !!token);
      // Insert a higher-specificity theme BEFORE loading another lazy stylesheet.
      await evaluate(`(()=>{
        const style=document.createElement('style');
        style.textContent=':root.theme-color-fixture { ${token}: #123456; }';
        document.head.prepend(style);document.documentElement.classList.add('theme-color-fixture');
        history.pushState(null,'','/warehouse/hall');dispatchEvent(new PopStateEvent('popstate'));
      })()`);
      await wait("!!document.querySelector('[data-receipt-launcher]')");
      check(`${language} late lazy CSS cannot override the central theme`,
        await evaluate("getComputedStyle(document.querySelector('.production')).color"), "rgb(18, 52, 86)");
      await evaluate("document.documentElement.classList.remove('theme-color-fixture')");
    }
  }
  await open("/orders/7/print"); await wait("!!document.querySelector('.opp-sheet')");
  const printBefore = await evaluate("({color:getComputedStyle(document.querySelector('.opp-sheet')).color,background:getComputedStyle(document.querySelector('.opp-sheet')).backgroundColor})");
  await evaluate("document.documentElement.style.setProperty('--ink','#ff00ff');document.documentElement.style.setProperty('--panel','#000000')");
  check(`${language} paper does not inherit screen theme ink`,
    await evaluate("({color:getComputedStyle(document.querySelector('.opp-sheet')).color,background:getComputedStyle(document.querySelector('.opp-sheet')).backgroundColor})"), printBefore);
  await send("Emulation.setEmulatedMedia", { media: "print" });
  check(`${language} print toolbar stays hidden`, await evaluate("getComputedStyle(document.querySelector('.opp-toolbar')).display"), "none");
  await send("Emulation.setEmulatedMedia", { media: "" });
  await fs.writeFile(path.join(output, `${language}-layout-findings.json`), JSON.stringify(layoutFindings, null, 2));
  console.log(`${language}: ${layoutFindings.length} layout findings recorded separately; this task preserves the original layout declarations.`);
};
