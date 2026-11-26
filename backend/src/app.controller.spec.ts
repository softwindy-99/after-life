import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as setupEnv from './setup/env';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
      jest.restoreAllMocks();
    });

    it('should return non-sensitive server info', () => {
      jest.spyOn(setupEnv, 'isRuntimeConfigured').mockReturnValue(true);

      expect(appController.getServerInfo()).toEqual({
        version: '1.0.0',
        status: 'ready',
        ipAddress: expect.any(String),
        supportedClientVersion: {
          min: '0.0.0',
          max: '1.0.0',
        },
      });
    });

    it('should allow version settings from environment variables', () => {
      process.env = {
        ...originalEnv,
        SERVER_VERSION: '1.2.3',
        SUPPORTED_CLIENT_VERSION_MIN: '1.0.0',
        SUPPORTED_CLIENT_VERSION_MAX: '1.9.9',
      };

      expect(appController.getServerInfo()).toMatchObject({
        version: '1.2.3',
        supportedClientVersion: {
          min: '1.0.0',
          max: '1.9.9',
        },
      });
    });

    it('should report uninitialized when env is incomplete', () => {
      jest.spyOn(setupEnv, 'isRuntimeConfigured').mockReturnValue(false);

      expect(appController.getServerInfo()).toMatchObject({
        status: 'uninitialized',
      });
    });
  });
});
