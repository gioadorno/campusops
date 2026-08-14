import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import yazl from 'yazl';

const output = resolve('dist/aws/campusops-mcp.zip');
const bundle = resolve('dist/aws/index.js');
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: ['apps/mcp-server/src/aws/lambda.ts'],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  target: 'node20',
  // The AWS SDK v3 ships CommonJS internals which dynamically require Node built-ins.
  // A CommonJS Lambda bundle preserves those calls under the Node.js runtime.
  format: 'cjs',
  sourcemap: true,
  legalComments: 'none'
});

const bundleContents = await readFile(bundle);
const bundleText = bundleContents.toString('utf8');
if (!bundleText.includes('module.exports') || bundleText.includes('Dynamic require of')) {
  throw new Error('Lambda bundle is not a loadable CommonJS artifact');
}

const zip = new yazl.ZipFile();
const date = new Date('2000-01-01T00:00:00.000Z');
zip.addBuffer(bundleContents, 'index.js', { mtime: date, mode: 0o100644 });
zip.addBuffer(await readFile(`${bundle}.map`), 'index.js.map', { mtime: date, mode: 0o100644 });
zip.end();
await new Promise<void>((resolvePromise, reject) => {
  zip.outputStream.pipe(createWriteStream(output)).on('close', resolvePromise).on('error', reject);
});
process.stdout.write(`${output}\n`);
