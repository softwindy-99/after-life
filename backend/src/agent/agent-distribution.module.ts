import { Module } from '@nestjs/common';
import { AgentDistributionController } from './agent-distribution.controller';
import { AgentDistributionService } from './agent-distribution.service';

@Module({
  controllers: [AgentDistributionController],
  providers: [AgentDistributionService],
})
export class AgentDistributionModule {}
