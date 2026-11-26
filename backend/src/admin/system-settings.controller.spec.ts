import { BadRequestException } from '@nestjs/common';
import { ApplicationRestartService } from 'src/setup/application-restart.service';
import { SystemSettingsController } from './system-settings.controller';

describe('SystemSettingsController', () => {
  let controller: SystemSettingsController;
  let systemSettingsService: {
    getSettings: jest.Mock;
    updateSettings: jest.Mock;
  };
  let restartService: { scheduleRestart: jest.Mock };

  beforeEach(() => {
    systemSettingsService = {
      getSettings: jest.fn(),
      updateSettings: jest.fn(),
    };
    restartService = { scheduleRestart: jest.fn() };
    controller = new SystemSettingsController(
      systemSettingsService as never,
      restartService as unknown as ApplicationRestartService,
    );
  });

  it('returns sanitized system settings', () => {
    const settings = { pushProxy: 'http://127.0.0.1:7890' };
    systemSettingsService.getSettings.mockReturnValue(settings);

    expect(controller.getSettings()).toBe(settings);
  });

  it('saves system settings and schedules an application reload', async () => {
    const payload = { pushProxy: 'http://127.0.0.1:7890' };
    const settings = { pushProxy: payload.pushProxy };
    systemSettingsService.updateSettings.mockReturnValue(settings);

    await expect(controller.updateSettings(payload)).resolves.toBe(settings);
    expect(systemSettingsService.updateSettings).toHaveBeenCalledWith(payload);
    expect(restartService.scheduleRestart).toHaveBeenCalledTimes(1);
  });

  it('does not reload the application when validation fails', async () => {
    systemSettingsService.updateSettings.mockImplementation(() => {
      throw new BadRequestException('invalid proxy');
    });

    await expect(controller.updateSettings({ pushProxy: 'invalid' })).rejects.toThrow(
      BadRequestException,
    );
    expect(restartService.scheduleRestart).not.toHaveBeenCalled();
  });
});
