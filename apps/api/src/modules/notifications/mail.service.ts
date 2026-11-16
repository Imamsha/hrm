import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import type { RenderedEmail } from './mail.templates.js';

export const EMAIL_QUEUE = 'email';
export const SEND_EMAIL_JOB = 'email.send';

export interface EmailJob extends RenderedEmail {
  to: string;
  /** Correlates delivery logs with the originating request. */
  requestId?: string;
}

/** Enqueues e-mail for asynchronous delivery (retries with backoff; never blocks requests). */
@Injectable()
export class MailService {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>) {}

  async send(email: EmailJob): Promise<void> {
    await this.queue.add(SEND_EMAIL_JOB, email, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
    });
  }
}

/** SMTP delivery worker. Message bodies are never logged (they contain one-time links). */
@Processor(EMAIL_QUEUE, { concurrency: 4 })
export class EmailProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.from = config.SMTP_FROM;
    this.transport = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
    });
  }

  async process(job: Job<EmailJob>): Promise<{ messageId: string }> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: job.data.to,
      subject: job.data.subject,
      text: job.data.text,
      html: job.data.html,
    });
    this.logger.log(
      `Delivered e-mail job ${String(job.id)} (request ${job.data.requestId ?? '-'})`,
    );
    return { messageId: info.messageId };
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
