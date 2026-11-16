import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { EMAIL_QUEUE, EmailProcessor, MailService } from './mail.service.js';

/** Phase 02 scope: transactional e-mail. In-app/push/SMS/WhatsApp arrive in Phase 14. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [MailService, EmailProcessor],
  exports: [MailService],
})
export class NotificationsModule {}
