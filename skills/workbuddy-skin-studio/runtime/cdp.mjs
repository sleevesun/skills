const LOOPBACK = '127.0.0.1';

export function assertLoopbackPort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('CDP port is invalid');
  return value;
}

async function json(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`CDP endpoint unavailable (${response?.status ?? 'unknown'})`);
  return response.json();
}

export async function probeCdp({ port = 9342, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');
  const validPort = assertLoopbackPort(port);
  const base = `http://${LOOPBACK}:${validPort}`;
  const version = await json(fetchImpl, `${base}/json/version`);
  const browserSocket = version.webSocketDebuggerUrl;
  if (!browserSocket) throw new Error('CDP browser websocket is missing');
  let browserUrl;
  try { browserUrl = new URL(browserSocket); } catch { throw new Error('CDP browser websocket is invalid'); }
  if (browserUrl.protocol !== 'ws:' && browserUrl.protocol !== 'wss:') throw new Error('CDP browser socket protocol is invalid');
  if (browserUrl.hostname !== LOOPBACK) throw new Error('CDP browser socket is not loopback');
  const browserIdMatch = /^\/devtools\/browser\/([A-Za-z0-9._-]{1,200})$/.exec(browserUrl.pathname);
  if (!browserIdMatch) throw new Error('CDP browser identity is invalid');
  const browserId = browserIdMatch[1];

  const targets = await json(fetchImpl, `${base}/json/list`);
  if (!Array.isArray(targets)) throw new Error('CDP target list is invalid');
  const pageTargets = targets.filter((target) => {
    if (!target || target.type !== 'page') return false;
    if (!target.webSocketDebuggerUrl) return false;
    let socketUrl;
    try { socketUrl = new URL(target.webSocketDebuggerUrl); } catch { return false; }
    if (socketUrl.protocol !== 'ws:' && socketUrl.protocol !== 'wss:') return false;
    if (socketUrl.hostname !== LOOPBACK) throw new Error('CDP renderer socket is not loopback');
    const url = target.url ?? '';
    if (/^(?:https?|ftp):/i.test(url)) return false;
    return true;
  });
  if (pageTargets.length === 0) throw new Error('no WorkBuddy renderer page target on loopback CDP');
  const target = pageTargets[0];
  return {
    port: validPort,
    browser: String(version.Browser ?? ''),
    browserId,
    target,
    version: String(version.product ?? version['User-Agent'] ?? ''),
  };
}

export class CdpClient {
  constructor({ target, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.target = target;
    this.WebSocketImpl = WebSocketImpl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async send(method, params = {}) {
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket implementation is unavailable');
    const socket = new this.WebSocketImpl(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')), { once: true });
    });
    const id = this.nextId++;
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 5000);
      socket.addEventListener('message', (event) => {
        let response;
        try { response = JSON.parse(event.data); } catch { return; }
        if (response.id !== id) return;
        clearTimeout(timer);
        resolve(response);
        try { socket.close(); } catch {}
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
    if (message.error) throw new Error(`CDP ${method} failed`);
    return message.result;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (result?.exceptionDetails) throw new Error('CDP Runtime.evaluate threw an exception');
    return result?.result?.value;
  }
}

export { LOOPBACK };
