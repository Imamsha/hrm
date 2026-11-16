import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { uuidSchema } from '@hrm/validation';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

/**
 * S3-compatible object storage.
 *
 * Tenant-aware layout: every object key is prefixed with `org/<organizationId>/`, built only
 * through `tenantKey()`, so a key for one tenant can never address another tenant's objects.
 * Upload/download APIs (presigned URLs, malware scanning, retention) arrive with the
 * Documents module; Phase 01 provides connectivity, bucket bootstrap and the key contract.
 */
@Injectable()
export class StorageService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  readonly client: S3Client;
  readonly bucket: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.STORAGE_BUCKET;
    this.client = new S3Client({
      endpoint: config.STORAGE_ENDPOINT,
      region: config.STORAGE_REGION,
      forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.STORAGE_ACCESS_KEY,
        secretAccessKey: config.STORAGE_SECRET_KEY,
      },
      maxAttempts: 2,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.STORAGE_AUTO_CREATE_BUCKET) return;
    try {
      await this.ensureBucket();
    } catch (err) {
      // Do not crash the API: readiness reports storage as down until it is reachable.
      this.logger.warn(`Could not ensure bucket "${this.bucket}": ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.ping();
    } catch (err) {
      const status = err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined;
      if (status !== 404) throw err;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    }
  }

  /** Builds a tenant-scoped object key. Rejects traversal and absolute segments. */
  static tenantKey(organizationId: string, ...segments: string[]): string {
    if (!uuidSchema.safeParse(organizationId).success)
      throw new Error('Invalid organization id for storage key');
    if (segments.length === 0) throw new Error('At least one key segment is required');
    for (const s of segments) {
      let hasControlChar = false;
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) hasControlChar = true;
      }
      if (!s || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || hasControlChar) {
        throw new Error(`Invalid storage key segment: ${JSON.stringify(s)}`);
      }
    }
    return ['org', organizationId, ...segments].join('/');
  }
}
