// video.mjs — shared "draw frames in headless Chromium, encode with ffmpeg".
//
// `setup` runs once in the page (with `setupArg`); `draw` runs per frame with
// `frameArg(k)` and must return a PNG data URL. Frames are piped straight into
// ffmpeg (H.264, yuv420p), so nothing is written to disk but the MP4. With
// `poster` (seconds), a 960px-wide JPEG still of that moment is written next
// to the MP4, for places that can't play video (e.g. a GitHub README).

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

// Playwright comes from web/: that copy is the one pinned to the browsers
// nixpkgs provides (see nix/tasks.nix), so logo/ doesn't pin a second one.
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('playwright');

export async function encodeVideo({ out, width, height, fps, frames, setup = null, setupArg = null, draw, frameArg, crf = 14, poster = null }) {
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-tune', 'grain',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ffmpeg.on('close', (code) => (code ? rej(new Error(`ffmpeg exited ${code}`)) : res())));

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    if (setup) await page.evaluate(setup, setupArg);
    for (let k = 0; k < frames; k++) {
      const url = await page.evaluate(draw, frameArg(k));
      const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    }
  } finally {
    ffmpeg.stdin.end();
    await browser.close();
  }
  await done;
  if (poster !== null) {
    await new Promise((res, rej) => spawn('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', String(poster), '-i', out,
      '-frames:v', '1', '-vf', 'scale=960:-1', '-q:v', '3', out.replace(/\.mp4$/, '.jpg'),
    ], { stdio: 'inherit' }).on('close', (c) => (c ? rej(new Error(`ffmpeg exited ${c}`)) : res())));
  }
}
