import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/user/user.entity';
import { CheckInController } from './check-in.controller';
import { CheckIn } from './check-in.entity';
import { CheckInService } from './check-in.service';

@Module({
  imports: [TypeOrmModule.forFeature([CheckIn, User])],
  controllers: [CheckInController],
  providers: [CheckInService],
  exports: [CheckInService],
})
export class CheckInModule {}
