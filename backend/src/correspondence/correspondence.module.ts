import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckIn } from 'src/check-in/check-in.entity';
import { ContactController } from 'src/contact/contact.controller';
import { Contact } from 'src/contact/contact.entity';
import { ContactService } from 'src/contact/contact.service';
import { LetterDelivery } from 'src/letter-delivery/letter-delivery.entity';
import { LetterDeliveryQueueService } from 'src/letter/letter-delivery-queue.service';
import { LetterController } from 'src/letter/letter.controller';
import { Letter } from 'src/letter/letter.entity';
import { LetterService } from 'src/letter/letter.service';
import { MailModule } from 'src/mail/mail.module';
import { UserModule } from 'src/user/user.module';
import { ResourceModule } from 'src/resource/resource.module';

// 信件与联系人共享收件关系，属于同一个事务边界。
// 在这里统一注册，避免 REST 与 MCP 各自创建一份服务和投递 worker。
// 服务文件仍按业务对象归档，HTTP 路径也保持 /letter 和 /contact。
@Module({
  imports: [
    TypeOrmModule.forFeature([Letter, Contact, CheckIn, LetterDelivery]),
    UserModule,
    MailModule,
    ResourceModule,
  ],
  controllers: [LetterController, ContactController],
  providers: [LetterService, ContactService, LetterDeliveryQueueService],
  exports: [LetterService, ContactService],
})
export class CorrespondenceModule {}
