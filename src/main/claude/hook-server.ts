import http from 'node:http';
import { ClaudeStateMachine } from './state-machine';

/**
 * Tiny localhost HTTP server that Claude Code hooks POST their JSON payloads to
 * (via `curl --data-binary @-`). Bound to 127.0.0.1 only.
 */
export class HookServer {
  private server: http.Server | null = null;
  private _port: number | null = null;

  constructor(private stateMachine: ClaudeStateMachine) {}

  get port(): number | null {
    return this._port;
  }

  async start(port: number): Promise<void> {
    await this.stop();
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        server.on('error', (err) => console.error('[hook-server]', err));
        this.server = server;
        this._port = port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this._port = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
      });
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');
        try {
          const payload = JSON.parse(body);
          this.stateMachine.handleHookEvent(payload);
        } catch {
          // Malformed hook payload; nothing to do.
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }
}
