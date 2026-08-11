const LOOPBACK = '127.0.0.1';

export function assertLoopbackCdp(endpoint) {
  const url = new URL(endpoint);
  if (url.hostname !== LOOPBACK || !['http:', 'https:'].includes(url.protocol)) throw new Error('CDP must be loopback-only');
  return url;
}

export async function probe(endpoint = 'http://127.0.0.1:9336') {
  const url = assertLoopbackCdp(endpoint);
  const [version, targets] = await Promise.all([
    fetch(`${url.origin}/json/version`).then((r) => r.json()),
    fetch(`${url.origin}/json/list`).then((r) => r.json()),
  ]);
  const identity = `${version.Browser ?? ''} ${version['User-Agent'] ?? version.userAgent ?? ''}`;
  if (!/workbuddy(?:[ /_-]*v?)?\d+\.\d+(?:\.\d+)?/i.test(identity)) throw new Error('Browser ID is not WorkBuddy');
  if (!Array.isArray(targets) || targets.length !== 1 || targets[0].type !== 'page' || !/workbuddy/i.test(`${targets[0].title} ${targets[0].url}`)) throw new Error('WorkBuddy renderer target is invalid');
  return { version, target: targets[0] };
}
