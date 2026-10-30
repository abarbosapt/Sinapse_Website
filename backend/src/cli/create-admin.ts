import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db.js';
import { createFirstAdmin } from '../users.js';

/** Pede um valor sem o mostrar no ecrã. */
function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelado.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error('Este comando é interativo e tem de ser executado num terminal.');
  }
  const config = loadConfig();
  const db = createPrismaClient(config.DATABASE_URL);
  try {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const email = (await rl.question('Email do administrador: ')).trim();
    const name = (await rl.question('Nome: ')).trim();
    rl.close();
    const password = await promptHidden('Palavra-passe (mínimo 12 caracteres): ');
    const confirmation = await promptHidden('Repita a palavra-passe: ');
    if (password !== confirmation) throw new Error('As palavras-passe não coincidem.');
    const user = await createFirstAdmin(db, { email, name, password });
    process.stdout.write(`Administrador criado: ${user.email}\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Erro desconhecido.';
  process.stderr.write(`Erro: ${message}\n`);
  process.exitCode = 1;
});
