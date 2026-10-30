import type { Config } from '../config.js';
import type { SessionPolicy } from './sessions.js';

/** Com HTTPS usa o prefixo __Host- (exige Secure, Path=/ e sem Domain). */
export function sessionCookieName(config: Config): string {
  return config.COOKIE_SECURE ? '__Host-sinapse_sid' : 'sinapse_sid';
}

export function sessionCookieOptions(config: Config, expires: Date) {
  return {
    path: '/',
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    expires,
  };
}

export function clearCookieOptions(config: Config) {
  return {
    path: '/',
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
  };
}

export function sessionPolicyFrom(config: Config): SessionPolicy {
  return {
    idleMinutes: config.SESSION_IDLE_MINUTES,
    absoluteHours: config.SESSION_ABSOLUTE_HOURS,
  };
}
