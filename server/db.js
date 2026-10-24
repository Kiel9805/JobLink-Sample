import pg from 'pg';

// null when DATABASE_URL is unset: the app still runs, just without the Places cache.
export const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
// Without a listener, a dropped idle connection crashes the process.
pool?.on('error', (err) => console.error(`Postgres pool error: ${err.message}`));
