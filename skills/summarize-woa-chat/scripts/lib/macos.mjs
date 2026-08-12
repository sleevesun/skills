import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WoaChatError } from "./errors.mjs";

const DEFAULT_INSPECTOR_URL = "http://127.0.0.1:9229";

export function inspectMacAccount(woaRoot, uid) {
  const kimRoot = path.join(woaRoot, "kim");
  return {
    uid: String(uid),
    kim_root: fs.existsSync(kimRoot),
    woa_running: Boolean(findWoaPid())
  };
}

export async function readMacMessages(options) {
  const inspector = await ensureWoaInspector({
    inspectorUrl: options.inspectorUrl,
    launchTimeoutMs: options.launchTimeoutMs
  });
  const rows = [];
  let total = 0;
  let schemaColumns = [];
  let quickCheck = "";
  const pageSize = Number(options.pageSize || 2000);
  const maxMessages = Number(options.maxMessages || 100000);
  try {
    const identity = await evaluateInWoa(inspector.webSocketDebuggerUrl, "({execPath:process.execPath,argv:process.argv})");
    if (!/WOA\.app/i.test(JSON.stringify(identity || {}))) {
      throw new WoaChatError("INSPECTOR_UNAVAILABLE", "127.0.0.1:9229 上的 Node Inspector 不属于 WOA。");
    }
    for (let offset = 0; offset === 0 || offset < total; offset += pageSize) {
      const payload = await evaluateInWoa(inspector.webSocketDebuggerUrl, buildMacPageExpression({
        woaRoot: options.woaRoot,
        uid: String(options.uid),
        chatId: String(options.chatId),
        startMs: options.startMs,
        endMs: options.endMs,
        limit: pageSize,
        offset
      }));
      if (!payload || !payload.ok) {
        const message = payload && payload.error ? payload.error : "WOA 进程内数据库读取失败";
        throw new WoaChatError(classifyMacReadError(message), message);
      }
      total = Number(payload.total || 0);
      if (total > maxMessages) {
        throw new WoaChatError("MESSAGE_LIMIT_EXCEEDED", `目标时间窗包含 ${total} 条消息，超过安全上限 ${maxMessages}。`, {
          total,
          max_messages: maxMessages
        });
      }
      quickCheck = payload.quick_check;
      schemaColumns = payload.columns || [];
      rows.push(...(payload.rows || []));
      if (!total || !(payload.rows || []).length) break;
    }
    return {
      rows,
      total,
      columns: schemaColumns,
      diagnostics: {
        quick_check: quickCheck,
        schema_columns: schemaColumns,
        pages: Math.ceil(total / pageSize),
        inspector_opened: inspector.opened
      }
    };
  } finally {
    if (inspector.opened) await closeInspector(inspector.webSocketDebuggerUrl).catch(() => {});
  }
}

export function buildMacPageExpression(options) {
  const payload = JSON.stringify(options);
  return `(async()=>{const o=${payload};try{
const R=process.mainModule.require.bind(process.mainModule);
const path=R('path'),fs=R('fs'),crypto=R('crypto'),electron=R('electron');
const Db=R('@ksxz/better-sqlite3-multiple-ciphers');
const kimRoot=path.join(o.woaRoot,'kim');
const accountHash=crypto.createHash('md5').update(o.uid+'_v1').digest('hex');
const keyHash=crypto.createHash('sha1').update(o.uid+':messages').digest('hex');
const keyName=fs.readdirSync(kimRoot).find((name)=>keyHash.startsWith(name));
if(!keyName)throw new Error('KEY_FILE_NOT_FOUND: WOA message key file not found');
const key=electron.safeStorage.decryptString(fs.readFileSync(path.join(kimRoot,keyName)));
const dbPath=path.join(kimRoot,accountHash,'ksxz-messages.sqlite');
const db=new Db(dbPath,{readonly:true,fileMustExist:true});
try{
db.pragma('cipher=sqlcipher');db.pragma('legacy=4');db.pragma('key='+JSON.stringify(key));
const quick=db.pragma('quick_check',{simple:true});
const columns=db.prepare('PRAGMA table_info(messages)').all().map((r)=>String(r.name));
const required=['id','from','to','ctime','content'];
const missing=required.filter((name)=>!columns.includes(name));
if(missing.length)throw new Error('UNSUPPORTED_SCHEMA: missing '+missing.join(','));
const optional=['type','cid','seq','pos','status','mentions','is_mention_all','extra','refer','refer_id','is_visible','is_read','notices','senderIdentity'];
const select=['"id" AS id','"from" AS from_uid','"to" AS to_uid','"ctime" AS ctime','"content" AS content'].concat(optional.filter((name)=>columns.includes(name)).map((name)=>'"'+name+'" AS "'+name+'"')).join(', ');
const peer='CASE WHEN CAST("to" AS TEXT)=CAST(? AS TEXT) THEN CAST("from" AS TEXT) ELSE CAST("to" AS TEXT) END';
const where='ctime >= ? AND ctime < ? AND '+peer+' = ?';
const params=[o.startMs,o.endMs,o.uid,o.chatId];
const total=db.prepare('SELECT count(*) AS count FROM messages WHERE '+where).get(...params).count;
const rows=db.prepare('SELECT '+select+' FROM messages WHERE '+where+' ORDER BY ctime ASC,id ASC LIMIT ? OFFSET ?').all(...params,o.limit,o.offset).map((row)=>{for(const key of Object.keys(row)){if(Buffer.isBuffer(row[key]))row[key]=row[key].toString('utf8')}return row});
return {ok:true,quick_check:quick,columns,total,rows};
}finally{db.close()}
}catch(e){return {ok:false,error:String(e&&e.stack||e)}}})()`;
}

export async function ensureWoaInspector(options = {}) {
  const candidateUrls = options.inspectorUrl
    ? [String(options.inspectorUrl)]
    : [DEFAULT_INSPECTOR_URL, "http://127.0.0.1:9230"];
  for (const url of candidateUrls) {
    const existing = await listInspectorTargets(url);
    for (const target of existing) {
      if (await isWoaTarget(target.webSocketDebuggerUrl)) {
        return { ...target, opened: false, inspectorUrl: url };
      }
    }
  }
  const inspectorUrl = options.inspectorUrl || DEFAULT_INSPECTOR_URL;
  let pid = findWoaPid();
  let launched = false;
  if (!pid) {
    const result = spawnSync("open", ["-a", "WOA", "--args", "--inspect=9229"], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new WoaChatError("INSPECTOR_UNAVAILABLE", "未找到正在运行的 WOA，且无法通过 open -a WOA 启动。");
    }
    launched = true;
  } else {
    try {
      process.kill(pid, "SIGUSR1");
    } catch {
      throw new WoaChatError("INSPECTOR_UNAVAILABLE", "无法向 WOA 主进程发送 SIGUSR1 以打开本地 Inspector。");
    }
  }
  const deadline = Date.now() + Number(options.launchTimeoutMs || 30000);
  while (Date.now() < deadline) {
    await sleep(250);
    const targets = await listInspectorTargets(inspectorUrl);
    if (targets.length) return { ...targets[0], opened: true, launched };
    if (!pid) pid = findWoaPid();
  }
  throw new WoaChatError("INSPECTOR_UNAVAILABLE", "WOA Node Inspector 未在超时前可用。");
}

export function findWoaPid(run = spawnSync) {
  const direct = run("pgrep", ["-x", "WOA"], { encoding: "utf8" });
  const directPid = firstPid(direct && direct.stdout);
  if (directPid) return directPid;
  const list = run("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (!list || list.status !== 0) return null;
  const line = String(list.stdout || "").split(/\r?\n/).find((item) => /\/WOA\.app\/Contents\/MacOS\/WOA(?:\s|$)/.test(item));
  return firstPid(line);
}

async function listInspectorTargets(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/json/list`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return [];
    const targets = await response.json();
    return (targets || []).filter((target) => target && target.type === "node" && target.webSocketDebuggerUrl);
  } catch {
    return [];
  }
}

async function evaluateInWoa(webSocketDebuggerUrl, expression) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = (event) => { clearTimeout(timer); reject(event.error || new Error("WebSocket error")); };
  });
  try {
    return await new Promise((resolve, reject) => {
      const id = 1;
      const timer = setTimeout(() => reject(new Error("Runtime.evaluate timeout")), 120000);
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timer);
        if (message.error) return reject(new Error(message.error.message || "Runtime.evaluate failed"));
        const result = message.result && message.result.result;
        if (result && result.subtype === "error") return reject(new Error(result.description || "Runtime.evaluate failed"));
        resolve(result ? result.value : undefined);
      };
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true, timeout: 120000 }
      }));
    });
  } finally {
    ws.close();
  }
}

async function closeInspector(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 3000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket error")); };
  });
  await new Promise((resolve) => {
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: "try{process.mainModule.require('inspector').close()}catch(e){}",
        awaitPromise: false,
        returnByValue: true,
        timeout: 1000
      }
    }));
    setTimeout(() => {
      try { ws.close(); } catch {}
      resolve();
    }, 250);
  });
}

async function isWoaTarget(webSocketDebuggerUrl) {
  try {
    const identity = await evaluateInWoa(webSocketDebuggerUrl, "({execPath:process.execPath,argv:process.argv})");
    return /WOA\.app/i.test(JSON.stringify(identity || {}));
  } catch {
    return false;
  }
}

function classifyMacReadError(message) {
  if (/KEY_FILE_NOT_FOUND/.test(message)) return "KEY_FILE_NOT_FOUND";
  if (/UNSUPPORTED_SCHEMA/.test(message)) return "UNSUPPORTED_SCHEMA";
  if (/not a database|cipher|decrypt/i.test(message)) return "DATABASE_DECRYPT_FAILED";
  return "DATABASE_READ_FAILED";
}

function firstPid(value) {
  const match = String(value || "").match(/\b(\d+)\b/);
  return match ? Number(match[1]) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
