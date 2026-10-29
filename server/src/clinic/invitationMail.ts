import nodemailer from 'nodemailer';
import { address } from '../identity/address.ts';
export interface InvitationMessage { to: string; clinic: string; roles: string[]; link: string; expiresAt: number }
export type InvitationMailer = (message: InvitationMessage) => Promise<void>;
/** No fallback sender, plaintext SMTP, traffic logging, file loading or URL attachments. */
export function invitationMailer(env: Record<string, string | undefined>): InvitationMailer | undefined {
  if (!env.STAFF_SMTP_HOST) return undefined;
  if (env.STAFF_SMTP_TLS_MODE && !['implicit','starttls'].includes(env.STAFF_SMTP_TLS_MODE)) throw Error('invalid staff SMTP TLS mode');
  const port = Number(env.STAFF_SMTP_PORT ?? 465), from = address(env.STAFF_SMTP_FROM);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !from || !env.STAFF_SMTP_USER || !env.STAFF_SMTP_PASSWORD) throw Error('incomplete staff SMTP configuration');
  const transport = nodemailer.createTransport({ host: env.STAFF_SMTP_HOST, port, secure: env.STAFF_SMTP_TLS_MODE === 'implicit' || port === 465, requireTLS: true,
    ...(env.STAFF_SMTP_SERVERNAME ? { servername: env.STAFF_SMTP_SERVERNAME } : {}),
    auth: { user: env.STAFF_SMTP_USER, pass: env.STAFF_SMTP_PASSWORD }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000, dnsTimeout: 10_000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  return async message => {
    const result = await transport.sendMail({ from, to: { address: message.to, name: '' }, subject: 'Запрошення до клініки — Протокол',
      text: `Вас запрошують до клініки «${message.clinic}». Ролі: ${message.roles.join(', ')}.\nВступ добровільний і не відкриває дані пацієнтів.\nУвійдіть із підтвердженою адресою одержувача та другим фактором, перегляньте умови й прийміть запрошення:\n${message.link}\nДіє до ${new Date(message.expiresAt).toISOString()}. Якщо ви не очікували листа, ігноруйте його.` });
    if (!result.accepted?.length || result.rejected?.length) throw Error('invitation delivery failed');
  };
}
