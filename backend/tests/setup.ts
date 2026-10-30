import { getTestDatabaseUrl } from './test-env.js';

process.env.DATABASE_URL = getTestDatabaseUrl();
