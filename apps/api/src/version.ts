import packageJson from '../package.json' with { type: 'json' };

/** API build version, reported by /v1/health and the OpenAPI document. */
export const API_VERSION: string = packageJson.version;
