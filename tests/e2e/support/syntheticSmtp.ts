// Loopback-only fixture: no external mail. Messages/codes stay in the ignored .e2e directory.
import { createServer, type TLSSocket } from 'node:tls';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
export async function syntheticSmtp(tls: { key: string; cert: string }) {
  const sockets = new Set<TLSSocket>(), messages: { to: string; code: string }[] = [];
  const server = createServer(tls, socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => undefined);
    let buffer = '', data = false, raw = '', to = '', auth = 0;
    socket.write('220 localhost synthetic SMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0,end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line !== '.') { raw += line + '\r\n'; continue; }
          data = false;
          const split = raw.indexOf('\r\n\r\n'), headers = raw.slice(0,split), body = raw.slice(split+4);
          const decoded = /Content-Transfer-Encoding: base64/i.test(headers) ? Buffer.from(body.replace(/\s/g,''),'base64').toString('utf8') : body.replace(/=\r\n/g, '').replace(/=3D/g, '=');
          const code = /#\/clinic\/invite\?code=([A-Za-z0-9_-]{43})/.exec(decoded)?.[1];
          if (code) { messages.push({ to, code }); writeFileSync('.e2e/invitations.json', JSON.stringify(messages)); }
          raw = ''; socket.write('250 accepted\r\n'); continue;
        }
        if (auth) { if (++auth === 3) { auth = 0; socket.write('235 authenticated\r\n'); } else socket.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (/^EHLO|^HELO/i.test(line)) socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 200000\r\n');
        else if (/^AUTH PLAIN/i.test(line)) socket.write('235 authenticated\r\n');
        else if (/^AUTH LOGIN/i.test(line)) { auth = 1; socket.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^MAIL FROM:/i.test(line)) socket.write('250 ok\r\n');
        else if (/^RCPT TO:/i.test(line)) { to = line.slice(8).trim().replace(/[<>]/g, ''); socket.write('250 ok\r\n'); }
        else if (line === 'DATA') { data = true; socket.write('354 send data\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { STAFF_SMTP_HOST: '127.0.0.1', STAFF_SMTP_PORT: String((server.address() as AddressInfo).port), STAFF_SMTP_TLS_MODE: 'implicit',
    STAFF_SMTP_SERVERNAME: 'localhost', STAFF_SMTP_FROM: 'protocol@example.invalid', STAFF_SMTP_USER: 'synthetic', STAFF_SMTP_PASSWORD: 'synthetic-smtp-password' };
  writeFileSync('.e2e/smtp.json', JSON.stringify(env));
  return { env, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
