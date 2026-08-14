import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoDirectory = resolve(root, 'docs/demo');
const fixture = resolve(demoDirectory, 'capture-fixture.html');
const screenshot = resolve(demoDirectory, 'campusops-workspace.png');
const gif = resolve(demoDirectory, 'campusops-governed-tool-flow.gif');
const mp4 = resolve(demoDirectory, 'campusops-governed-tool-flow.mp4');
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const ffmpeg = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';

const scenes = [
  { step: 0, gifSeconds: 1.4, videoSeconds: 3.5 },
  { step: 1, gifSeconds: 1.6, videoSeconds: 4 },
  { step: 2, gifSeconds: 1.4, videoSeconds: 4 },
  { step: 3, gifSeconds: 2.1, videoSeconds: 5 },
  { step: 4, gifSeconds: 1.6, videoSeconds: 4 },
  { step: 5, gifSeconds: 3.2, videoSeconds: 7 },
  { step: 6, gifSeconds: 1.4, videoSeconds: 3.5 },
  { step: 7, gifSeconds: 2.1, videoSeconds: 5 }
] as const;

const concatManifest = (frames: string[], durations: number[]): string => {
  const entries = frames.flatMap((frame, index) => [
    `file '${frame.replaceAll("'", "'\\''")}'`,
    `duration ${durations[index]}`
  ]);
  entries.push(`file '${frames.at(-1)?.replaceAll("'", "'\\''")}'`);
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
  try {
    const frames: string[] = [];
    for (const scene of scenes) {
      const frame = resolve(temporary, `scene-${scene.step}.png`);
      const fixtureUrl = new URL(pathToFileURL(fixture));
      fixtureUrl.searchParams.set('step', String(scene.step));
      await run(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-sandbox',
        '--force-device-scale-factor=1',
        '--window-size=1440,900',
        '--virtual-time-budget=750',
        `--screenshot=${frame}`,
        fixtureUrl.toString()
      ]);
      frames.push(frame);
    }

    await copyFile(frames[5]!, screenshot);
    const gifManifest = resolve(temporary, 'gif-frames.txt');
    const videoManifest = resolve(temporary, 'video-frames.txt');
    await writeFile(
      gifManifest,
      concatManifest(
        frames,
        scenes.map(({ gifSeconds }) => gifSeconds)
      )
    );
    await writeFile(
      videoManifest,
      concatManifest(
        frames,
        scenes.map(({ videoSeconds }) => videoSeconds)
      )
    );

    await run(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      gifManifest,
      '-vf',
      'fps=8,scale=960:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
      '-loop',
      '0',
      gif
    ]);
    await run(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      videoManifest,
      '-vf',
      'scale=1440:900:flags=lanczos,format=yuv420p',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '24',
      '-movflags',
      '+faststart',
      mp4
    ]);

    process.stdout.write(
      [
        `Screenshot: ${screenshot} (${await fileSize(screenshot)})`,
        `GIF: ${gif} (${await fileSize(gif)})`,
        `MP4: ${mp4} (${await fileSize(mp4)})`
      ].join('\n') + '\n'
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

await main();
