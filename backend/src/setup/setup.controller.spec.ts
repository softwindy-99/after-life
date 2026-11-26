import { ApplicationRestartService } from './application-restart.service';
import { SetupController } from './setup.controller';
import { SetupPayload, SetupService } from './setup.service';

describe('SetupController', () => {
  const payload: SetupPayload = {
    PORT: '3000',
  };
  const result = {
    initialized: true,
    message: 'saved',
  };

  it('schedules an application restart after setup succeeds', async () => {
    const setupService = {
      initialize: jest.fn().mockResolvedValue(result),
    };
    const restartService = {
      scheduleRestart: jest.fn(),
    };
    const controller = new SetupController(
      setupService as unknown as SetupService,
      restartService as unknown as ApplicationRestartService,
    );

    await expect(controller.initialize(payload)).resolves.toEqual(result);
    expect(restartService.scheduleRestart).toHaveBeenCalledTimes(1);
  });

  it('does not restart the application when setup fails', async () => {
    const setupService = {
      initialize: jest.fn().mockRejectedValue(new Error('setup failed')),
    };
    const restartService = {
      scheduleRestart: jest.fn(),
    };
    const controller = new SetupController(
      setupService as unknown as SetupService,
      restartService as unknown as ApplicationRestartService,
    );

    await expect(controller.initialize(payload)).rejects.toThrow('setup failed');
    expect(restartService.scheduleRestart).not.toHaveBeenCalled();
  });
});
