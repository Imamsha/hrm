# ADR-007: S3-compatible object storage

- Status: Accepted (2026-11-16)

## Context

The approved plan named MinIO for local S3. MinIO no longer publishes public images
(`minio/minio` on Docker Hub returns "object not found"; Quay requires authentication).

## Decision

- Local/CI object storage uses **RustFS 1.0.4** (`rustfs/rustfs`, Apache-2.0, S3-compatible,
  maintained; 1.0.4 released 2026-10-25). Ports 9000 (S3) / 9001 (console).
- The API uses only the generic AWS SDK v3 S3 client (`forcePathStyle` configurable), so any
  S3-compatible service (AWS S3, Cloudflare R2, Wasabi, SeaweedFS, MinIO builds) works by changing
  `STORAGE_*` variables. No RustFS-specific code exists.
- Tenant layout: `org/<organizationId>/<segments…>` built only via `StorageService.tenantKey()`,
  which rejects traversal, separators and control characters.
- `STORAGE_AUTO_CREATE_BUCKET` is allowed only outside production.

## Consequences

This deviates from the approved "MinIO" item; behaviour and interfaces are unchanged. Upload and
download flows (presigned URLs, malware scanning, retention, encryption settings) arrive with the
Documents module.
