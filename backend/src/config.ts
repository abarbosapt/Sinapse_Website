import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().refine((value) => value.startsWith('postgresql://'), {
    message: 'tem de começar por postgresql://',
  }),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(12),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Só nomes de variáveis e motivos: nunca imprimir valores (podem ser segredos).
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuração inválida: ${problems}`);
  }
  return parsed.data;
}
