// Uploads files to Hostinger's file storage with the TUS flow (see CLAUDE.md → Hosting).
// Credentials come from `hosting_files_generate-upload-url`, saved as JSON outside the repo:
//   { "url": ".../api/tus", "auth_key": "...", "rest_auth_key": "..." }
//
// Usage: node scripts/hostinger-upload.mjs <creds.json> <local>=<remote> [...]
//        node scripts/hostinger-upload.mjs <creds.json> --delete <remote> [...]
import fs from 'node:fs';

const [credsPath, ...args] = process.argv.slice(2);
const { url, auth_key, rest_auth_key } = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
const auth = { 'X-Auth': auth_key, 'X-Auth-Rest': rest_auth_key };
const encode = (p) => p.split('/').map(encodeURIComponent).join('/');

if (args[0] === '--delete') {
  for (const remote of args.slice(1)) {
    const r = await fetch(`${url.replace(/\/tus$/, '')}/resources/${encode(remote)}`, { method: 'DELETE', headers: auth });
    console.log(r.ok ? 'DEL ' : 'FAIL', remote, r.status);
    if (!r.ok) process.exitCode = 1;
  }
} else {
  const tus = { ...auth, 'Tus-Resumable': '1.0.0' };
  for (const pair of args) {
    const [local, remote] = pair.split('=');
    const buf = fs.readFileSync(local);
    const target = `${url}/${encode(remote)}?override=true`;
    const r1 = await fetch(target, { method: 'POST', headers: { ...tus, 'Upload-Length': String(buf.length), 'Upload-Offset': '0' } });
    const r2 = await fetch(target, {
      method: 'PATCH',
      headers: { ...tus, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
      body: buf,
    });
    const offset = r2.headers.get('upload-offset');
    const ok = r1.status === 201 && r2.status === 204 && Number(offset) === buf.length;
    console.log(ok ? 'OK  ' : 'FAIL', remote, buf.length, r1.status, r2.status, offset);
    if (!ok) process.exitCode = 1;
  }
}
