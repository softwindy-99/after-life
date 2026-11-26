import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from 'src/auth/auth.decorator';
import { AgentDistributionService } from './agent-distribution.service';

// Public, fixed product assets only. No config, personal data, or caller-selected paths.
@Controller('ai')
@Public()
export class AgentDistributionController {
  constructor(private readonly distribution: AgentDistributionService) {}

  @Get()
  manifest(@Res() response: Response): void {
    this.prepare(response);
    response.json(this.distribution.manifest());
  }

  @Get('skill.json')
  bundle(@Res() response: Response): void {
    this.prepare(response);
    response.json(this.distribution.bundle());
  }

  @Get('SKILL.md')
  skill(@Res() response: Response): void {
    this.prepare(response);
    response.type('text/markdown').send(this.distribution.file('SKILL.md'));
  }

  @Get('references/tools.md')
  reference(@Res() response: Response): void {
    this.prepare(response);
    response.type('text/markdown').send(this.distribution.file('references/tools.md'));
  }

  @Get('cli.mjs')
  cli(@Res() response: Response): void {
    this.prepare(response);
    response.attachment('afterlife.mjs').type('text/javascript');
    response.send(this.distribution.file('scripts/afterlife.mjs'));
  }

  @Get('skill.tar.gz')
  archive(@Res() response: Response): void {
    this.prepare(response);
    response.attachment('use-after-life.tar.gz').type('application/gzip');
    response.send(this.distribution.tarball());
  }

  private prepare(response: Response): void {
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
  }
}
