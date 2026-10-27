import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import type { OidcRegistry } from '../modules/auth/oidc';
import type { MalwareScanner } from '../modules/media/processing';
import type { MailAdapter } from '../services/mail';
import type { StorageAdapter } from '../storage';

// Decorations added by buildApp(). Available on every encapsulated module instance.
declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    /** False when the app was built without a database (some unit tests). */
    hasDatabase: boolean;
    /** Restricted runtime role (fieldline_app). Throws if hasDatabase is false. */
    db: Database;
    /** Owner connection; only through withPlatform() (src/db/runtime.ts). */
    platformDb: Database;
    oidc: OidcRegistry;
    storage: StorageAdapter;
    scanner: MalwareScanner;
    mail: MailAdapter;
  }
}
