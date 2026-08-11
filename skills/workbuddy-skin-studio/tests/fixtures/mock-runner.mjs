import { createServer } from 'node:http';

const server = createServer((request, response) => {
  const body = request.url === '/json/version'
    ? { Browser: 'WorkBuddy/1.0', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/1' }
    : [{ type: 'page', title: 'WorkBuddy', url: 'workbuddy://home', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' }];
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${server.address().port}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
