import { one, pool } from '../src/db.js';

const a = await one(
  "SELECT COUNT(*) AS n FROM dbo.AppUsers WHERE username LIKE 'e2e%'"
);
const c = await one(
  "SELECT COUNT(*) AS n FROM dbo.Client WHERE IdClient LIKE 'TEST-E2E%'"
);
const db = await one('SELECT DB_NAME() AS name');
console.log(
  JSON.stringify({
    e2eUsers: Number(a.n),
    testClients: Number(c.n),
    db: db.name,
  })
);
await (await pool()).close();
