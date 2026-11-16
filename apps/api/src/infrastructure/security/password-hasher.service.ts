import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Algorithm, hash, verify } from '@node-rs/argon2';

/** `Algorithm.Argon2id` — the package exports an ambient const enum, unusable with isolatedModules. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- const enum cannot be imported as a value
const ARGON2ID = 2 as Algorithm;

/**
 * argon2id with OWASP-recommended minimum parameters (m=19 MiB, t=2, p=1).
 * Parameters are encoded in the PHC string, so they can be raised later without breaking
 * existing hashes.
 */
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Hash of a random value, verified against when the account does not exist (timing parity). */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(`dummy-${String(Math.random())}`, OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same work as a real verification so unknown e-mails are not distinguishable by timing. */
  async verifyDummy(password: string): Promise<false> {
    if (!this.dummyHash) this.dummyHash = await hash('dummy', OPTIONS);
    await verify(this.dummyHash, password).catch(() => false);
    return false;
  }
}
