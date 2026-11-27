// social.mjs — the GitHub social preview (1280x640 PNG).
//
// The brand lockup and tagline on the landing-page gradient, beside two real
// screenshots of the app (captured by social-shots.mjs). The lockup is the
// committed SVG, so the brand cannot drift from this image.
//
// Run through `just assets`: it provides Chromium.
//
//   node src/social.mjs --out renders/social/social-preview.png

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 1280;
const H = 640;

const dataUrl = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;

export function composeHtml({ lockup, gradient, back, front }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0}
  body{width:${W}px;height:${H}px;overflow:hidden;position:relative;
       background:url(${gradient}) center/cover;font-family:Roboto,Inter,'Helvetica Neue',Arial,sans-serif}
  /* the gradient is pale: a veil keeps the dark text and shots crisp */
  .veil{position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,.55) 0,rgba(255,255,255,.2) 45%,rgba(255,255,255,0) 70%)}
  .lockup{position:absolute;left:72px;top:206px;width:400px}
  .tag{position:absolute;left:74px;top:296px;width:440px;font-size:30px;line-height:1.25;font-weight:500;color:#111;letter-spacing:-.2px}
  .sub{position:absolute;left:74px;top:408px;font-size:16px;font-weight:400;color:#3b3f45;letter-spacing:0}
  .shot{position:absolute;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,.12),0 24px 60px rgba(30,30,60,.28);
        border:1px solid rgba(0,0,0,.08)}
  .back{left:600px;top:48px;width:760px}
  .front{left:540px;top:268px;width:760px}
  </style></head><body>
  <div class="veil"></div>
  <img class="shot back" src="${back}">
  <img class="shot front" src="${front}">
  <img class="lockup" src="${lockup}">
  <div class="tag">System architecture,<br>modeled as code.</div>
  <div class="sub">System models · Derived diagrams · Source of truth</div>
  </body></html>`;
}

export async function renderSocial({ out, shots, lockupSvg, gradientJpg }) {
  const html = composeHtml({
    lockup: dataUrl(lockupSvg, 'image/svg+xml'),
    gradient: dataUrl(gradientJpg, 'image/jpeg'),
    back: dataUrl(path.join(shots, 'drone-overview.png'), 'image/png'),
    front: dataUrl(path.join(shots, 'drone-main.png'), 'image/png'),
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log(`wrote ${out} (${W}x${H})`);
  } finally {
    await browser.close();
  }
}

const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  await renderSocial({
    out: opt('out', path.join(here, '../renders/social/social-preview.png')),
    shots: opt('shots', path.join(here, '../renders/social/shots')),
    lockupSvg: opt('lockup', path.join(here, '../renders/molecule/lockup-ref.svg')),
    gradientJpg: opt('gradient', path.join(here, '../../web/assets/landing-gradient.jpg')),
  });
}
