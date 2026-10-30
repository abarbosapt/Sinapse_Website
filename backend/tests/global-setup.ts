import { execFileSync } from 'node:child_process';
import { getTestDatabaseUrl } from './test-env.js';

export default function globalSetup() {
  const databaseUrl = getTestDatabaseUrl();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
