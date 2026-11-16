import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthReport, LivenessReport } from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';
import { Public } from '../access/decorators.js';
import { HealthService } from './health.service.js';

/**
 * Health endpoints are unauthenticated by design (load balancers / orchestrators).
 * They expose dependency status and latency only, never configuration or credentials.
 */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the process is running' })
  @ApiOkResponse({ description: 'Process is alive' })
  live(): LivenessReport {
    return this.health.liveness();
  }

  @Get()
  @ApiOperation({ summary: 'Full dependency report (always 200; status is ok or degraded)' })
  @ApiOkResponse({ description: 'Dependency report' })
  report(): Promise<HealthReport> {
    return this.health.report();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: 200 when every dependency is up, otherwise 503' })
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({ description: 'One or more dependencies are down' })
  async ready(): Promise<HealthReport> {
    const report = await this.health.report();
    if (report.status !== 'ok') {
      const details = Object.entries(report.checks)
        .filter(([, c]) => c.status === 'down')
        .map(([name, c]) => ({ path: name, message: c.error ?? 'down' }));
      throw AppException.serviceUnavailable('One or more dependencies are unavailable', details);
    }
    return report;
  }
}
