const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { readFileSync } = require("node:fs");
const http = require("node:http");
const { once } = require("node:events");
const { gzipSync } = require("node:zlib");
const test = require("node:test");
const express = require("express");

const minimum = {
  "body-parser": { 1: "1.20.9", 2: "2.4.0" },
  zod: { 4: "4.6.6" },
  multer: { 2: "2.5.0" },
  "@azure/msal-node": { 7: "7.1.0" },
  nodemailer: { 10: "10.1.4" },
  "fast-uri": { 3: "3.1.9" },
};

test("every resolved instance of the affected packages meets a patched minimum", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", `file://${__filename}`)));
  const semver = require("semver");
  for (const name of Object.keys(minimum)) {
    const entries = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${name}`));
    assert.ok(entries.length, `${name} must be checked`);
    for (const [location, { version }] of entries) {
      const patched = minimum[name][semver.major(version)];
      assert.ok(patched && semver.gte(version, patched), `${location}@${version} is not patched`);
    }
  }
});

async function serve(t, app) {
  const server = http.createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

for (const [owner, label] of [["express", "Express 4"], ["@modelcontextprotocol/sdk/server/mcp.js", "MCP Express 5"]]) {
  test(`${label} parses ordinary bodies and survives trailing bytes after gzip`, async t => {
    const consumer = createRequire(require.resolve(owner));
    const parser = createRequire(consumer.resolve("express"))("body-parser");
    const app = express();
    app.use(parser.json());
    app.post("/", (req, res) => res.json(req.body));
    app.use((err, _req, res, _next) => res.status(err.status || 400).json({ error: "invalid body" }));
    const base = await serve(t, app);
    const body = JSON.stringify({ synthetic: true });
    for (const bytes of [Buffer.from(body), gzipSync(body), Buffer.concat([gzipSync(body), Buffer.from("trailing bytes")])]) {
      const compressed = bytes[0] === 0x1f;
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(compressed ? { "Content-Encoding": "gzip" } : {}) },
        body: bytes,
      });
      assert.ok([200, 400].includes(response.status));
      if (response.status === 200) assert.deepEqual(await response.json(), { synthetic: true });
      else await response.text();
    }
    // The vulnerable decoder throws after the response has already finished.
    await new Promise(resolve => setTimeout(resolve, 50));
    const alive = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(alive.status, 200);
  });
}

test("multer handles a pending asynchronous filter after another file is rejected", async t => {
  const multer = require("multer");
  let filtered = 0;
  const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter(_req, file, callback) {
      filtered++;
      setTimeout(() => file.originalname === "reject.txt"
        ? callback(new Error("synthetic rejection"))
        : callback(null, true), file.originalname === "reject.txt" ? 20 : 60);
    },
  }).array("files");
  const app = express();
  app.post("/", (req, res) => upload(req, res, error => {
    if (error) return res.status(400).json({ error: error.message });
    res.json({ files: req.files.map(file => file.buffer.toString()) });
  }));
  const base = await serve(t, app);
  const rejected = new FormData();
  rejected.append("files", new Blob(["reject"]), "reject.txt");
  rejected.append("files", new Blob(["pending"]), "pending.txt");
  assert.equal((await fetch(base, { method: "POST", body: rejected })).status, 400);
  assert.equal(filtered, 2, "the second filter must be pending during teardown");
  await new Promise(resolve => setTimeout(resolve, 100));
  const accepted = new FormData();
  accepted.append("files", new Blob(["accepted"]), "accepted.txt");
  const response = await fetch(base, { method: "POST", body: accepted });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { files: ["accepted"] });
});

test("Nodemailer does not promote quoted text or nested comments into recipients", async () => {
  const nodemailer = require("nodemailer");
  const addressparser = require("nodemailer/lib/addressparser");
  assert.equal(addressparser('<"a@evil.com>"@good.com>')[0].address, '"a@evil.com>"@good.com');
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  for (const [to, expected] of [
    // SMTP serialization replaces angle brackets inside quoted local parts;
    // the parser and envelope must still agree on the intended domain.
    ['<"a@evil.com>"@good.com>', '"a@evil.com "@good.com'],
    ["Victim (x(y) <evil@evil.com>) <v@victim.com>", "v@victim.com"],
    ["G: (a; <evil@evil.com>) <v@victim.com>;", "v@victim.com"],
    ['G: "a;" "<evil@evil.com>" <v@victim.com>;', "v@victim.com"],
  ]) {
    const mail = await transport.sendMail({ from: "test@example.invalid", to, subject: "Synthetic", text: "No network delivery" });
    assert.deepEqual(mail.envelope.to, [expected]);
  }
});

test("Ajv's actual fast-uri consumer rejects scheme and host confusion and preserves relative scope", () => {
  const consumer = createRequire(require.resolve("ajv"));
  const uri = consumer("fast-uri");
  assert.notEqual(uri.parse("%6Aavascript:alert(1)").scheme, "javascript");
  assert.notEqual(uri.normalize("%6Aavascript:alert(1)"), "javascript:alert(1)");
  for (const input of ["http://a@b@evil.example/", "http://exa\tmple.com/"]) {
    assert.ok(uri.parse(input).error);
  }
  const base = "https://example.invalid/one/two/";
  for (const input of ["a/../b", "../x"]) {
    assert.equal(uri.resolve(base, uri.normalize(input)), uri.resolve(base, input));
  }
  assert.match(uri.serialize({ path: "javascript:alert(1)" }, { reference: "suffix" }), /^javascript%3A/i);
  const Ajv = require("ajv");
  assert.equal(new Ajv().compile({ type: "integer" })(42), true);
});

test("Zod 4 rejects oversized constrained arrays before evaluating their elements", async () => {
  const { z } = require("zod");
  let evaluated = 0;
  const schema = z.array(z.string().superRefine(() => { evaluated++; })).max(2);
  for (const parse of [input => schema.safeParse(input), input => schema.safeParseAsync(input)]) {
    const result = await parse(Array(10000).fill("synthetic"));
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
  }
  assert.equal(evaluated, 0);
});

test("upgraded Drizzle schemas, form resolver, and validation errors use the same Zod 4 contract", async () => {
  const { z } = require("zod");
  const { pgTable, text } = require("drizzle-orm/pg-core");
  const { createInsertSchema } = require("drizzle-zod");
  const { zodResolver } = require("@hookform/resolvers/zod");
  const { fromZodError } = require("zod-validation-error");
  const schema = createInsertSchema(pgTable("synthetic", { name: text().notNull() }), { name: z.string().min(1) });
  assert.deepEqual(schema.parse({ name: "valid" }), { name: "valid" });
  const invalid = schema.safeParse({ name: "" });
  assert.equal(invalid.success, false);
  assert.match(fromZodError(invalid.error).message, /name/);
  const resolve = zodResolver(schema);
  const options = { fields: {}, shouldUseNativeValidation: false };
  assert.deepEqual((await resolve({ name: "valid" }, {}, options)).values, { name: "valid" });
  assert.equal((await resolve({ name: "" }, {}, options)).errors.name.type, "too_small");
});

test("Azure Identity can acquire a SQL token through patched MSAL using only a synthetic transport", async () => {
  const consumer = createRequire(require.resolve("tedious"));
  const { ClientSecretCredential } = consumer("@azure/identity");
  const { createHttpHeaders } = require("@azure/core-rest-pipeline");
  const tenant = "00000000-0000-4000-8000-000000000001";
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const requests = [];
  const credential = new ClientSecretCredential(tenant, "00000000-0000-4000-8000-000000000002", "synthetic-not-a-secret", {
    disableInstanceDiscovery: true,
    httpClient: {
      async sendRequest(request) {
        requests.push(request);
        const url = new URL(request.url);
        assert.equal(url.origin, "https://login.microsoftonline.com");
        let body;
        if (url.pathname.endsWith("/.well-known/openid-configuration")) {
          body = { authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`,
            issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
            jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys" };
        } else {
          assert.equal(url.pathname, `/${tenant}/oauth2/v2.0/token`);
          body = { token_type: "Bearer", expires_in: 3600, access_token: "synthetic-access-token" };
        }
        return { request, status: 200, headers: createHttpHeaders({ "Content-Type": "application/json" }), bodyAsText: JSON.stringify(body) };
      },
    },
  });
  const token = await credential.getToken("https://database.windows.net/.default");
  assert.equal(token.token, "synthetic-access-token");
  const request = requests.find(request => request.method === "POST");
  assert.equal(new URLSearchParams(request.body).get("grant_type"), "client_credentials");
  assert.equal(new URLSearchParams(request.body).get("scope"), "https://database.windows.net/.default");
});
