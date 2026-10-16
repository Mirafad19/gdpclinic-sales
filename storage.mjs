import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function openStore(root) {
  let execute;
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    execute = (text, params = []) => {
      let index = 0;
      return sql.query(text.replace(/\?/g, () => `$${++index}`), params);
    };
  } else {
    if (process.env.VERCEL) throw new Error('Set DATABASE_URL to a Neon Postgres database before deploying.');
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(join(root, 'data'), { recursive: true });
    const local = new DatabaseSync(process.env.DATABASE_PATH || join(root, 'data/clinic.sqlite'));
    execute = async (text, params = []) => local.prepare(text).all(...params);
  }
  for (const statement of [
    'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires BIGINT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS orders (reference TEXT PRIMARY KEY, session TEXT NOT NULL,
      product TEXT NOT NULL, provider TEXT NOT NULL, email TEXT NOT NULL, amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created BIGINT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS orders_session ON orders(session)'
  ]) await execute(statement);
  return { prepare: text => ({
    get: async (...params) => (await execute(text, params))[0],
    all: (...params) => execute(text, params),
    run: (...params) => execute(text, params)
  }) };
}
