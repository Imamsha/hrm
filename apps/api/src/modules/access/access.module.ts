import { Global, Module } from '@nestjs/common';
import { AccessGuard } from './access.guard.js';
import { AccessService } from './access.service.js';

@Global()
@Module({
  providers: [AccessService, AccessGuard],
  exports: [AccessService, AccessGuard],
})
export class AccessModule {}
