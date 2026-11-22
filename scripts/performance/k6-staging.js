// k6 read-only capacity test for an ISOLATED staging environment only.
// Install k6 separately. Never point this script at the production Curb Connect URL.
// 100k-visits is 100,000 synthetic visits, NOT 100,000 concurrent authenticated users.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const base = String(__ENV.BASE_URL || '').trim().replace(/\/+$/, '');
const match = /^https?:\/\/([^/]+)(?:\/|$)/i.exec(base);
if (!match) throw new Error('Set BASE_URL to an explicit staging or localhost URL.');
const host = match[1].toLowerCase();
if (!/(^|[-.])(staging|preview)([-.]|$)/.test(host) && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
  throw new Error('Refusing load against a non-staging host. Create an isolated staging deployment.');
}
if (__ENV.CONFIRM_STAGING !== 'YES') {
  throw new Error('Explicit opt-in required: -e CONFIRM_STAGING=YES');
}

const profile = __ENV.PROFILE || 'smoke';
if (profile === '100k-visits' && __ENV.CONFIRM_100K !== 'YES') {
  throw new Error('100k-visits requires -e CONFIRM_100K=YES, a capacity budget and monitoring.');
}
const profiles = {
  smoke: {
    executor: 'constant-vus',
    vus: 5,
    duration: '30s',
  },
  baseline: {
    executor: 'ramping-vus',
    startVUs: 2,
    stages: [
      { duration: '1m', target: 20 },
      { duration: '2m', target: 50 },
      { duration: '1m', target: 0 },
    ],
  },
  '100k-visits': {
    executor: 'shared-iterations',
    iterations: 100000,
    vus: 100,
    maxDuration: '6h',
  },
};
if (!Object.prototype.hasOwnProperty.call(profiles, profile)) {
  throw new Error('PROFILE must be smoke, baseline or 100k-visits.');
}

export const options = {
  scenarios: { read_only: { ...profiles[profile], exec: 'readOnlyVisit' } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

export function readOnlyVisit() {
  const tag = String(exec.scenario.iterationInTest);
  const headers = { 'X-Synthetic-Visit': tag };
  const page = http.get(`${base}/sign-in?choose=1`, { headers, tags: { flow: 'sign-in' } });
  check(page, { 'sign-in page responds 200': (response) => response.status === 200 });
  const health = http.get(`${base}/v1/health`, { headers, tags: { flow: 'health' } });
  check(health, { 'health endpoint responds 200': (response) => response.status === 200 });
  sleep(Math.random() * 2);
}
