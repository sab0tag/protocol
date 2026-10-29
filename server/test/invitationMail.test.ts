import { beforeEach, describe, expect, it, vi } from 'vitest';
const { send, create } = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: create } }));
import { invitationMailer } from '../src/clinic/invitationMail.ts';
const env = { STAFF_SMTP_HOST: 'smtp.example.invalid', STAFF_SMTP_PORT: '587', STAFF_SMTP_FROM: 'protocol@example.invalid', STAFF_SMTP_USER: 'synthetic', STAFF_SMTP_PASSWORD: 'synthetic-password' };
beforeEach(() => { send.mockReset().mockResolvedValue({ accepted: ['recipient@example.invalid'], rejected: [] }); create.mockReset().mockReturnValue({ sendMail: send }); });
describe('staff invitation mail adapter', () => {
  it('does not connect without explicit configuration and rejects unsafe/incomplete settings', () => {
    expect(invitationMailer({})).toBeUndefined(); expect(create).not.toHaveBeenCalled();
    for (const patch of [{ STAFF_SMTP_PASSWORD: '' }, { STAFF_SMTP_FROM: 'a@example.invalid\r\nBcc:b@example.invalid' }, { STAFF_SMTP_PORT: '0' }, { STAFF_SMTP_TLS_MODE: 'none' }]) expect(() => invitationMailer({ ...env, ...patch })).toThrow();
  });
  for (const port of ['465','587']) it(`requires verified TLS and bounded I/O on port ${port}`, async () => {
    const mail = invitationMailer({ ...env, STAFF_SMTP_PORT: port })!;
    expect(create.mock.calls[0]?.[0]).toMatchObject({ secure: port === '465', requireTLS: true, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, connectionTimeout: 10_000, socketTimeout: 15_000 });
    await mail({ to: 'recipient@example.invalid', clinic: 'Synthetic Clinic', roles: ['doctor'], link: 'https://app.test/#/clinic/invite?code=synthetic', expiresAt: 1800000000000 });
    const message = send.mock.calls[0]?.[0]; expect(message).toMatchObject({ to: { address: 'recipient@example.invalid', name: '' }, from: env.STAFF_SMTP_FROM });
    expect(message.text).toContain('#/clinic/invite?code=synthetic'); expect(message.html).toBeUndefined(); expect(message.attachments).toBeUndefined();
  });
  it('does not report successful submission when the recipient was rejected', async () => {
    send.mockResolvedValue({ accepted: [], rejected: ['recipient@example.invalid'] });
    await expect(invitationMailer(env)!({ to: 'recipient@example.invalid', clinic: 'Synthetic', roles: ['doctor'], link: 'https://app.test/#/clinic/invite?code=x', expiresAt: 1800000000000 })).rejects.toThrow('delivery failed');
  });
});
