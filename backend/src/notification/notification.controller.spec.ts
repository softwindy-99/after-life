import { NotificationController } from './notification.controller';

describe('NotificationController', () => {
  const notificationService = {
    getConfig: jest.fn(),
    getStatus: jest.fn(),
    register: jest.fn(),
    updatePreferences: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new NotificationController(notificationService as never);
  const request = { user: { uuid: 'user-1' } } as never;

  beforeEach(() => jest.clearAllMocks());

  it('delegates notification configuration and subscription operations', async () => {
    notificationService.getConfig.mockReturnValue({ publicKey: 'key', configured: true });
    notificationService.getStatus.mockResolvedValue({ subscribed: false, preferences: null });
    notificationService.register.mockResolvedValue({ subscribed: true });
    notificationService.updatePreferences.mockResolvedValue({ subscribed: true });
    notificationService.remove.mockResolvedValue(undefined);

    expect(controller.config()).toEqual({ publicKey: 'key', configured: true });
    await controller.status(request, { endpoint: 'https://push.example/one' });
    await controller.register(request, {
      subscription: {
        endpoint: 'https://push.example/one',
        keys: { p256dh: 'public', auth: 'auth' },
      },
    });
    await controller.updatePreferences(request, {
      endpoint: 'https://push.example/one',
      preferences: { dailyReminderTime: '10:00' },
    });
    await controller.remove(request, { endpoint: 'https://push.example/one' });

    expect(notificationService.getStatus).toHaveBeenCalledWith(
      'user-1',
      'https://push.example/one',
    );
    expect(notificationService.register).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      undefined,
    );
    expect(notificationService.updatePreferences).toHaveBeenCalledWith(
      'user-1',
      'https://push.example/one',
      { dailyReminderTime: '10:00' },
    );
    expect(notificationService.remove).toHaveBeenCalledWith('user-1', {
      endpoint: 'https://push.example/one',
    });
  });
});
