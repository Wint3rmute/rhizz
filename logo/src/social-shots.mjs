// social-shots.mjs — real screenshots of the running app, for the social image.
//
// Creates a project from the Quadcopter Drone example in the app at --url,
// opens two of its diagram views and saves a 1920x1080 PNG of each. social.mjs
// composes them with the logo. Nothing is mocked: these are the app's own pixels.
//
// Run through `just logo-social-shots`: it starts the dev server and provides
// Chromium.
//
//   node src/social-shots.mjs --url http://localhost:5199 --outdir renders/social/shots

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Playwright comes from web/ (see video.mjs).
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('playwright');

// [diagram file in the drone example, output name]
export const SHOTS = [
  ['drone-overview.hcl', 'drone-overview.png'],
  ['main.hcl', 'drone-main.png'],
];

export async function captureShots({ url, outdir }) {
  fs.mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch();
  try {
    // reducedMotion cuts diagram transitions, so the frame is final when drawn.
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    page.once('dialog', (d) => d.accept('drone'));
    await page.goto(url);
    await page.getByRole('button', { name: 'Learn by example' }).click();
    // The example list scrolls under the modal's footer, so click via the DOM.
    await page.getByRole('button', { name: /Quadcopter Drone/ }).dispatchEvent('click');
    await page.waitForURL(/\/projects\/[^/]+\/(code|overview)/);
    const base = page.url().replace(/\/(code|overview).*$/, '');
    for (const [file, out] of SHOTS) {
      await page.goto(`${base}/modeling/${file}`);
      await page.getByText('Score:').waitFor();
      await page.waitForTimeout(1500); // fit-to-view + font settle
      await page.screenshot({ path: path.join(outdir, out) });
      console.log(`wrote ${path.join(outdir, out)}`);
    }
  } finally {
    await browser.close();
  }
}

const isCLI = typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  await captureShots({ url: opt('url', 'http://localhost:5199'), outdir: opt('outdir', 'renders/social/shots') });
}
