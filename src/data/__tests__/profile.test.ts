import { emailLooksValid } from '../profile';

describe('emailLooksValid', () => {
  it('accepts normal addresses', () => {
    expect(emailLooksValid('driver@example.com')).toBe(true);
    expect(emailLooksValid('  jordan.b+rig@mail.co ')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(emailLooksValid('')).toBe(false);
    expect(emailLooksValid('driver')).toBe(false);
    expect(emailLooksValid('driver@')).toBe(false);
    expect(emailLooksValid('driver@host')).toBe(false);
    expect(emailLooksValid('a b@c.com')).toBe(false);
  });
});
