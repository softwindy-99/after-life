import { NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { LetterController } from './letter.controller';
import { LetterService } from './letter.service';
import { newLetterSchema, updateLetterSchema } from './letter.schema';

const request = { user: { uuid: 'owner' } } as unknown as Request;
describe('LetterController', () => {
  const service = {
    findByUser: jest.fn(),
    findOwnedOne: jest.fn(),
    insert: jest.fn(),
    updateOwned: jest.fn(),
    removeOwned: jest.fn(),
    previewDelivery: jest.fn(),
  };
  const controller = new LetterController(service as unknown as LetterService);
  beforeEach(() => jest.resetAllMocks());

  it('returns safe DTOs instead of owner entities or persistence fields', async () => {
    service.findByUser.mockResolvedValue([
      { uuid: 'letter', id: 1, user: { password: 'private' }, extra: { hidden: true } },
    ]);
    expect(await controller.query(request)).toEqual([{ uuid: 'letter' }]);
    expect(service.findByUser).toHaveBeenCalledWith('owner');
  });

  it('forwards normalized creation fields and the human review without redundant ownership lookups', async () => {
    service.insert.mockResolvedValue({ uuid: 'letter' });
    const input = newLetterSchema.parse({
      title: '  Hello  ',
      content: ' <p>World</p> ',
      deliveryEnabled: true,
      inactiveAfterMinutes: '1440',
      deliveryPreviewToken: 'review',
    });
    expect(await controller.create(input, request)).toEqual({ uuid: 'letter' });
    expect(service.insert).toHaveBeenCalledWith(
      {
        title: 'Hello',
        content: '<p>World</p>',
        inactiveAfterMinutes: 1440,
        deliveryEnabled: true,
        contacts: undefined,
        user: { uuid: 'owner' },
      },
      { token: 'review' },
    );
  });

  it('binds updates to the current owner and forwards the version and review to the write transaction', async () => {
    service.updateOwned.mockResolvedValue({ uuid: 'letter' });
    const updatedAt = new Date().toISOString();
    const input = updateLetterSchema.parse({
      title: 'Updated',
      expectedUpdatedAt: updatedAt,
      deliveryPreviewToken: 'review',
    });
    await controller.update('letter', input, request);
    expect(service.updateOwned).toHaveBeenCalledWith(
      'letter',
      'owner',
      { title: 'Updated', contacts: undefined },
      undefined,
      updatedAt,
      { token: 'review' },
    );
    service.updateOwned.mockResolvedValue(null);
    await expect(controller.update('missing', input, request)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delegates previews without enabling delivery', async () => {
    const input = { title: 'Hello', content: '<p>World</p>', inactiveAfterMinutes: 1440 };
    service.previewDelivery.mockResolvedValue({ token: 'review' });
    expect(await controller.previewDelivery(input, request)).toEqual({ token: 'review' });
    expect(service.previewDelivery).toHaveBeenCalledWith('owner', input);
    expect(service.insert).not.toHaveBeenCalled();
    expect(service.updateOwned).not.toHaveBeenCalled();
  });

  it('removes owned letters and preserves missing-letter semantics', async () => {
    service.findOwnedOne.mockResolvedValue({ uuid: 'letter' });
    await controller.remove('letter', request);
    expect(service.removeOwned).toHaveBeenCalledWith('letter', 'owner');
    service.findOwnedOne.mockResolvedValue(null);
    await expect(controller.remove('missing', request)).rejects.toBeInstanceOf(NotFoundException);
  });
});
