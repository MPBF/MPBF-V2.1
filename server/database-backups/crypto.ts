import { Worker } from "node:worker_threads";

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_CLEAR_BYTES = 96 * 1024 * 1024;
export function backupError(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export function validatePassphrase(passphrase: string) {
  if (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 256 || !/\S/.test(passphrase)) {
    backupError("BACKUP_PASSPHRASE");
  }
}

// Inline worker survives the single-file production build. No plaintext files.
const workerSource = `
const {parentPort,workerData}=require("node:worker_threads");
const {scryptSync,randomBytes,createCipheriv,createDecipheriv}=require("node:crypto");
const {gzipSync,gunzipSync}=require("node:zlib");
const MAGIC=Buffer.from("MPBFBK01"), MAX=${MAX_CLEAR_BYTES}, MAX_ARCHIVE=${MAX_ARCHIVE_BYTES};
let key,plain;
try {
  if(workerData.mode==="encrypt"){
    plain=Buffer.from(JSON.stringify(workerData.document),"utf8");
    if(plain.length>MAX)throw Error("BACKUP_TOO_LARGE");
    const salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([MAGIC,salt,iv]);
    key=scryptSync(workerData.passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(header);
    const zipped=gzipSync(plain);
    const ciphertext=Buffer.concat([cipher.update(zipped),cipher.final()]);
    zipped.fill(0);
    const archive=Buffer.concat([header,cipher.getAuthTag(),ciphertext]);
    if(archive.length>MAX_ARCHIVE)throw Error("BACKUP_TOO_LARGE");
    const bytes=Uint8Array.from(archive);parentPort.postMessage({bytes:bytes.buffer},[bytes.buffer]);
  }else{
    const archive=Buffer.from(workerData.bytes);
    if(archive.length<53||archive.length>MAX_ARCHIVE||!archive.subarray(0,8).equals(MAGIC))throw Error("BACKUP_INVALID");
    key=scryptSync(workerData.passphrase,archive.subarray(8,24),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const decipher=createDecipheriv("aes-256-gcm",key,archive.subarray(24,36));
    decipher.setAAD(archive.subarray(0,36));decipher.setAuthTag(archive.subarray(36,52));
    const zipped=Buffer.concat([decipher.update(archive.subarray(52)),decipher.final()]);
    plain=gunzipSync(zipped,{maxOutputLength:MAX});zipped.fill(0);
    parentPort.postMessage({document:JSON.parse(plain.toString("utf8"))});
  }
}catch(error){
  parentPort.postMessage({error:error.message==="BACKUP_TOO_LARGE"?"BACKUP_TOO_LARGE":"BACKUP_INVALID"});
}finally{if(key)key.fill(0);if(plain)plain.fill(0);}
`;

let activeWorkers = 0;
function run(mode: "encrypt" | "decrypt", passphrase: string, value: unknown): Promise<any> {
  validatePassphrase(passphrase);
  if (activeWorkers >= 2) backupError("BACKUP_BUSY", 503);
  return new Promise((resolve, reject) => {
    activeWorkers++;
    let worker: Worker;
    try {
      worker = new Worker(workerSource, {
        eval: true, resourceLimits: { maxOldGenerationSizeMb: 384 },
        workerData: { mode, passphrase, ...(mode === "encrypt" ? { document: value } : { bytes: value }) },
      });
    } catch {
      activeWorkers--; reject(Object.assign(new Error("BACKUP_WORKER_FAILED"), { status: 503 })); return;
    }
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true; activeWorkers--; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error("BACKUP_TIMEOUT"), { status: 503 })), 90_000);
    worker.on("message", result => result.error
      ? finish(Object.assign(new Error(result.error), { status: result.error === "BACKUP_TOO_LARGE" ? 413 : 400 }))
      : finish(undefined, mode === "encrypt" ? Buffer.from(result.bytes) : result.document));
    worker.on("error", () => finish(Object.assign(new Error("BACKUP_WORKER_FAILED"), { status: 503 })));
    worker.on("exit", () => { if (!settled) finish(Object.assign(new Error("BACKUP_WORKER_FAILED"), { status: 503 })); });
  });
}
export const encryptBackup = (document: unknown, passphrase: string): Promise<Buffer> => run("encrypt", passphrase, document);
export const decryptBackup = (bytes: Buffer, passphrase: string): Promise<unknown> => {
  if (bytes.length > MAX_ARCHIVE_BYTES) backupError("BACKUP_TOO_LARGE", 413);
  return run("decrypt", passphrase, bytes);
};
