import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import WebSocket, { type RawData } from 'ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoDirectory = resolve(root, 'docs/demo');
const fixture = resolve(demoDirectory, 'capture-fixture.html');
const screenshot = resolve(demoDirectory, 'campusops-workspace.png');
const gif = resolve(demoDirectory, 'campusops-governed-tool-flow.gif');
const mp4 = resolve(demoDirectory, 'campusops-governed-tool-flow.mp4');
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const ffmpegPath = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';

interface CdpMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
  params?: {
    data?: string;
    sessionId?: number;
  };
}

interface DevToolsTarget {
  type: string;
  webSocketDebuggerUrl?: string;
}

interface CapturedFrame {
  path: string;
  receivedAt: number;
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly socket: WebSocket,
    private readonly onFrame: (message: CdpMessage) => void
  ) {
    socket.on('message', (data: RawData) => {
      const serialized = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : data.toString('utf8');
      const message = JSON.parse(serialized) as CdpMessage;
      if (message.method === 'Page.screencastFrame') {
        this.onFrame(message);
        return;
      }
      if (message.id === undefined) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? 'Chrome CDP error'));
      else request.resolve(message.result);
    });
  }

  command(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  acknowledge(sessionId: number): void {
    void this.command('Page.screencastFrameAck', { sessionId });
  }
}

const runProcess = async (command: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      errors = `${errors}${chunk.toString()}`.slice(-4000);
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} failed (${code ?? 'signal'}): ${errors.trim()}`));
    });
  });
};

const stopProcess = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
    wait(2000).then(() => undefined)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
};

const readDevToolsPort = async (directory: string): Promise<number> => {
  const activePort = resolve(directory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const [port] = (await readFile(activePort, 'utf8')).split('\n');
      if (port && Number.isInteger(Number(port))) return Number(port);
    } catch {
      // Chrome writes the file after the debugging socket is ready.
    }
    await wait(100);
  }
  throw new Error('Chrome DevTools did not become ready');
};

const pageDebuggerUrl = async (port: number): Promise<string> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = (await response.json()) as DevToolsTarget[];
      const page = targets.find(
        (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string'
      );
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // The page target can lag slightly behind the browser debugging socket.
    }
    await wait(100);
  }
  throw new Error('Chrome page target did not become ready');
};

const connectWebSocket = async (url: string): Promise<WebSocket> =>
  new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolvePromise(socket));
    socket.once('error', rejectPromise);
  });

const waitForDemo = async (client: CdpClient): Promise<void> => {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = (await client.command('Runtime.evaluate', {
      expression: 'window.__demoComplete === true',
      returnByValue: true
    })) as { result?: { value?: boolean } };
    if (result.result?.value === true) return;
    await wait(250);
  }
  throw new Error('The browser demo timeline did not complete');
};

const concatManifest = (frames: CapturedFrame[]): string => {
  const entries: string[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const next = frames[index + 1];
    const duration = next
      ? Math.min(0.25, Math.max(1 / 120, (next.receivedAt - frame.receivedAt) / 1000))
      : 1 / 30;
    entries.push(`file '${frame.path.replaceAll("'", "'\\''")}'`, `duration ${duration}`);
  }
  entries.push(`file '${frames.at(-1)?.path.replaceAll("'", "'\\''")}'`);
  return `${entries.join('\n')}\n`;
};

const fileSize = async (path: string): Promise<string> => {
  const bytes = (await stat(path)).size;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
};

const main = async (): Promise<void> => {
  await readFile(fixture, 'utf8');
  await mkdir(demoDirectory, { recursive: true });
  const temporary = await mkdtemp(resolve(tmpdir(), 'campusops-demo-'));
  const chromeData = resolve(temporary, 'chrome');
  const framesDirectory = resolve(temporary, 'frames');
  await mkdir(chromeData);
  await mkdir(framesDirectory);

  const fixtureUrl = new URL(pathToFileURL(fixture));
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=1',
      '--window-size=1440,900',
      '--remote-debugging-port=0',
      `--user-data-dir=${chromeData}`,
      fixtureUrl.toString()
    ],
    { stdio: 'ignore' }
  );

  let socket: WebSocket | undefined;
  try {
    const port = await readDevToolsPort(chromeData);
    socket = await connectWebSocket(await pageDebuggerUrl(port));
    const frames: CapturedFrame[] = [];
    const writes: Array<Promise<void>> = [];
    let frameNumber = 0;
    const client = new CdpClient(socket, (message) => {
      const data = message.params?.data;
      const sessionId = message.params?.sessionId;
      if (!data || sessionId === undefined) return;
      const frame = resolve(framesDirectory, `frame-${String(frameNumber++).padStart(5, '0')}.jpg`);
      frames.push({ path: frame, receivedAt: performance.now() });
      writes.push(writeFile(frame, Buffer.from(data, 'base64')));
      client.acknowledge(sessionId);
    });

    await client.command('Page.enable');
    await client.command('Runtime.enable');
    await client.command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.command('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: 1440,
      maxHeight: 900,
      everyNthFrame: 1
    });
    await wait(500);
    await client.command('Runtime.evaluate', { expression: 'void window.startDemo()' });
    await waitForDemo(client);
    await client.command('Page.stopScreencast');
    await Promise.all(writes);
    if (frames.length < 100) throw new Error(`Chrome captured only ${frames.length} frames`);

    const manifest = resolve(temporary, 'recording-frames.txt');
    await writeFile(manifest, concatManifest(frames));
    await runProcess(ffmpegPath, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      manifest,
      '-vf',
      'fps=30,scale=1440:900:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-movflags',
      '+faststart',
      '-an',
      mp4
    ]);
    await runProcess(ffmpegPath, ['-y', '-ss', '18', '-i', mp4, '-frames:v', '1', screenshot]);
    await runProcess(ffmpegPath, [
      '-y',
      '-i',
      mp4,
      '-vf',
      'fps=10,scale=960:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop',
      '0',
      gif
    ]);

    process.stdout.write(
      [
        `Captured ${frames.length} continuous browser frames.`,
        `Screenshot: ${screenshot} (${await fileSize(screenshot)})`,
        `GIF: ${gif} (${await fileSize(gif)})`,
        `MP4: ${mp4} (${await fileSize(mp4)})`
      ].join('\n') + '\n'
    );
  } finally {
    socket?.close();
    await stopProcess(chrome);
    await rm(temporary, { recursive: true, force: true });
  }
};

await main();
