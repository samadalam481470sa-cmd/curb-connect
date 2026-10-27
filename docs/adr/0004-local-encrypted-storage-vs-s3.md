# ADR 0004: Local encrypted storage for development, S3-compatible storage for production

- Status: Accepted
- Date: 2026-10-26
- Requirements: BE-075, PLT-018, LCH-091, LCH-092

## Context

The platform stores job-site photos, drone imagery, blueprints, generated PDFs and signed
contracts. These contain customer addresses, faces, license plates and EXIF GPS, so they must be
encrypted at rest, tenant-scoped and never publicly addressable. Production should use
S3-compatible object storage; the development machine has no Docker or MinIO, and tests must not
depend on a network service.

## Decision

Define a `StorageAdapter` interface (put via signed upload, get via signed download, head, delete,
copy) with two implementations:

- **LocalEncryptedStorage** for development and tests: AES-256-GCM encrypted files under
  `apps/api/.data/objects` (git-ignored), key from `STORAGE_ENCRYPTION_KEY`, with short-lived
  HMAC-signed upload/download URLs served by the API itself.
- **S3Storage** for staging/production: presigned PUT/GET URLs, server-side encryption, private
  bucket, via `@aws-sdk/client-s3`.

Both enforce the same rules: tenant-prefixed object keys, SHA-256 checksum and de-duplication,
MIME sniffing with `file-type` (never trust the client's content type), size limits, and a
malware-scan adapter. In development the scanner is a no-op that records `scanStatus:
"not_scanned"`; nothing claims a file was scanned when it was not. EXIF GPS is extracted into a
restricted field and stripped from shared copies. `infra/docker-compose.yml` provides MinIO for
anyone who wants to exercise the S3 path locally.

## Consequences

- Tests and local development need no external storage service, yet exercise encryption, signing
  and validation code paths that production also relies on.
- Two implementations must be kept behaviorally identical; a shared adapter contract test suite
  runs against both (S3 against MinIO when available).
- Signed URLs for local storage are served by the API, so local file throughput is limited by the
  API process; acceptable for development only.

## Revisit triggers

- The owner selects a hosting provider whose object store needs a dedicated adapter.
- Production malware scanning is chosen (replace the no-op scanner before handling public uploads).
- Large media volumes that call for direct-to-CDN delivery or lifecycle tiering.
