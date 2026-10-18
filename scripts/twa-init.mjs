// One-time: creates the SplitEasy Android (Trusted Web Activity) project in android/spliteasy/
// from the live web manifest — the non-interactive equivalent of `bubblewrap init`.
// Afterwards, edit android/spliteasy/twa-manifest.json and run `npx bubblewrap update` there.
//
//   node scripts/twa-init.mjs
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ConsoleLog, TwaGenerator, TwaManifest } from '@bubblewrap/core';

const dir = new URL('../android/spliteasy/', import.meta.url);
const dirPath = decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (existsSync(join(dirPath, 'twa-manifest.json'))) {
  console.error('android/spliteasy already exists; edit twa-manifest.json and run `npx bubblewrap update` instead.');
  process.exit(1);
}
mkdirSync(dirPath, { recursive: true });

const twa = await TwaManifest.fromWebManifest('https://apps.ranjithkumarmadhavan.com/spliteasy/manifest.webmanifest');
Object.assign(twa, {
  packageId: 'com.ranjithkumarmadhavan.spliteasy',
  name: 'SplitEasy',
  launcherName: 'SplitEasy',
  startUrl: '/spliteasy/',
  themeColor: twa.themeColor, // #0f9d6b from the web manifest
  navigationColor: twa.themeColor,
  appVersionName: '1.0.0',
  appVersionCode: 1,
  enableNotifications: false,
  fallbackType: 'customtabs',
  orientation: 'portrait',
  signingKey: {
    // Outside the repo; never commit the keystore or its password.
    path: join(homedir(), '.android-keys', 'spliteasy', 'upload-keystore.jks'),
    alias: 'upload',
  },
});

const error = twa.validate();
if (error) {
  console.error('Invalid TWA manifest:', error);
  process.exit(1);
}
await twa.saveToFile(join(dirPath, 'twa-manifest.json'));
await new TwaGenerator().createTwaProject(dirPath, twa, new ConsoleLog('twa-init'));
console.log('Created', dirPath);
