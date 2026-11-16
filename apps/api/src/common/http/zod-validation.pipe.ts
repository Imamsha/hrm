import { Injectable, type PipeTransform } from '@nestjs/common';
import { toErrorDetails } from '@hrm/validation';
import type { z } from 'zod';
import { AppException } from './app.exception.js';

/**
 * Validates and transforms a request part with a shared Zod schema from `@hrm/validation`.
 * Usage: `@Body(new ZodValidationPipe(createThingSchema)) body: CreateThing`.
 */
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw AppException.validation(toErrorDetails(result.error));
    return result.data;
  }
}
