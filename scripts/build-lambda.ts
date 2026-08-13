import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import yazl from 'yazl';

const output = resolve('dist/aws/campusops-mcp.zip');
const bundle = resolve('dist/aws/index.mjs');
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: ['apps/mcp-server/src/aws/lambda.ts'],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none'
});

const zip = new yazl.ZipFile();
const date = new Date('2000-01-01T00:00:00.000Z');
zip.addBuffer(await readFile(bundle), 'index.mjs', { mtime: date, mode: 0o100644 });
zip.addBuffer(await readFile(`${bundle}.map`), 'index.mjs.map', { mtime: date, mode: 0o100644 });
zip.end();
await new Promise<void>((resolvePromise, reject) => {
  zip.outputStream.pipe(createWriteStream(output)).on('close', resolvePromise).on('error', reject);
});
process.stdout.write(`${output}\n`);
