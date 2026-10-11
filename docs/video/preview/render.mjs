// Stream frames directly to FFmpeg: no large intermediate frame directory.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(modulePath);
const root = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.argv[2] || 'offerly-preview-60s.mp4');
await mkdir(resolve(output, '..'), { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let encoder;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => { throw error; });
  await page.goto(new URL('index.html', import.meta.url).href);
  await page.evaluate(() => window.ready);
  encoder = spawn(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', '30', '-i', 'pipe:0',
    '-i', resolve(root, 'assets/score.m4a'), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-t', '60', '-movflags', '+faststart', output], { stdio: ['pipe', 'inherit', 'inherit'] });
  const completion = once(encoder, 'close');
  encoder.on('error', error => { throw error; });
  for (let frame = 0; frame < 1800; frame++) {
    await page.evaluate(time => window.setTime(time), frame / 30);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!encoder.stdin.write(jpg)) await once(encoder.stdin, 'drain');
    if (frame % 150 === 0) console.log(`${frame / 30}/60 seconds rendered`);
  }
  encoder.stdin.end();
  const [code] = await completion;
  if (code !== 0) throw new Error(`FFmpeg exited with ${code}`);
  console.log(output);
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill('SIGTERM');
  await browser.close();
}
