import { ApplicationRestartService } from './application-restart.service';

describe('ApplicationRestartService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a registered restart handler after the response delay', async () => {
    const service = new ApplicationRestartService();
    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerRestartHandler(handler);

    service.scheduleRestart(250);
    service.scheduleRestart(250);
    await jest.advanceTimersByTimeAsync(250);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending restart when the application is destroyed', async () => {
    const service = new ApplicationRestartService();
    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerRestartHandler(handler);
    service.scheduleRestart(250);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(250);

    expect(handler).not.toHaveBeenCalled();
  });
});
