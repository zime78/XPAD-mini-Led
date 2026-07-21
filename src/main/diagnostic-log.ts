import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG_BYTES = 1024 * 1024;

export type DiagnosticFields = Record<string, boolean | number | string | null>;

export class DiagnosticLog {
  readonly filePath: string;

  private enabled = true;
  private currentBytes = 0;
  private writeQueue = Promise.resolve();

  constructor(userDataPath: string) {
    const logDirectory = path.join(userDataPath, 'logs');
    this.filePath = path.join(logDirectory, 'fine-volume.jsonl');
    try {
      fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
      this.rotateIfNeeded();
      this.currentBytes = this.currentLogSize();
    } catch (error) {
      this.enabled = false;
      console.error('[diagnostics] log initialization failed', error);
    }
  }

  log(event: string, fields: DiagnosticFields = {}): void {
    if (!this.enabled) return;
    const entry = JSON.stringify({
      ...sanitizeFields(fields),
      timestamp: new Date().toISOString(),
      event,
    });
    const line = `${entry}\n`;
    const lineBytes = Buffer.byteLength(line);
    const shouldRotate = this.currentBytes + lineBytes > MAX_LOG_BYTES;
    if (shouldRotate) this.currentBytes = 0;
    this.currentBytes += lineBytes;
    this.writeQueue = this.writeQueue
      .then(async () => {
        if (shouldRotate) this.rotate();
        await fs.promises.appendFile(this.filePath, line, {
          encoding: 'utf8',
          mode: 0o600,
        });
      })
      .catch((error) => {
        this.enabled = false;
        console.error('[diagnostics] log write failed', error);
      });
  }

  flush(): Promise<void> {
    return this.writeQueue;
  }

  private rotateIfNeeded(): void {
    try {
      if (fs.statSync(this.filePath).size < MAX_LOG_BYTES) return;
      this.rotate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private rotate(): void {
    try {
      fs.copyFileSync(this.filePath, `${this.filePath}.previous`);
      fs.truncateSync(this.filePath, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private currentLogSize(): number {
    try {
      return fs.statSync(this.filePath).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }
}

function sanitizeFields(fields: DiagnosticFields): DiagnosticFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? sanitizeString(value) : value,
    ])
  );
}

function sanitizeString(value: string): string {
  return value
    .replace(/\/Users\/[^/\s]+/g, '~')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}
