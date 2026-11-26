import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ContactService } from 'src/contact/contact.service';
import { LetterService } from 'src/letter/letter.service';
import { MailModule } from 'src/mail/mail.module';
import { MailService } from 'src/mail/mail.service';
import { CorrespondenceModule } from './correspondence.module';

// Verify Nest's actual module graph without opening a database or starting workers.
@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        options: { type: 'mysql' },
        entityMetadatas: [],
        getRepository: () => ({}),
      },
    },
  ],
  exports: [DataSource],
})
class TestDatabaseModule {}

@Module({ providers: [{ provide: MailService, useValue: {} }], exports: [MailService] })
class TestMailModule {}

const probe = (provide: string) => ({
  provide,
  inject: [LetterService, ContactService],
  useFactory: (letters: LetterService, contacts: ContactService) => ({ letters, contacts }),
});

@Module({ imports: [CorrespondenceModule], providers: [probe('rest')] })
class RestConsumer {}
@Module({ imports: [CorrespondenceModule], providers: [probe('mcp')] })
class McpConsumer {}

describe('CorrespondenceModule', () => {
  it('shares the same services across HTTP and tool consumers', async () => {
    const module = await Test.createTestingModule({
      imports: [TestDatabaseModule, RestConsumer, McpConsumer],
    })
      .overrideModule(MailModule)
      .useModule(TestMailModule)
      .compile();
    try {
      const rest = module.get<{ letters: LetterService; contacts: ContactService }>('rest');
      const mcp = module.get<{ letters: LetterService; contacts: ContactService }>('mcp');
      expect(rest.letters).toBe(mcp.letters);
      expect(rest.contacts).toBe(mcp.contacts);
      expect(rest.letters).toBeInstanceOf(LetterService);
      expect(rest.contacts).toBeInstanceOf(ContactService);
    } finally {
      await module.close();
    }
  });
});
