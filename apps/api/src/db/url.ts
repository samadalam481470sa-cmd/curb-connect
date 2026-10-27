/** "user@host:port/db" for logs. Never log a connection string: it contains the password. */
export function describeDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  return `${user}@${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Guard for anything destructive: only databases whose name ends in "_test" qualify. */
export function assertTestDatabaseUrl(url: string): void {
  const name = databaseName(url);
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to use database "${name}" for tests: its name must end in "_test" (TEST_DATABASE_URL).`,
    );
  }
}
