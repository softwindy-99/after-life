import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactController } from './contact.controller';

describe('ContactController', () => {
  let controller: ContactController;
  let contactService: {
    findByUser: jest.Mock;
    findOwnedOne: jest.Mock;
    insert: jest.Mock;
    updateOwned: jest.Mock;
    removeOwned: jest.Mock;
  };
  let userService: {
    findOne: jest.Mock;
  };
  let letterService: {
    findOwnedOne: jest.Mock;
  };

  beforeEach(() => {
    contactService = {
      findByUser: jest.fn(),
      findOwnedOne: jest.fn(),
      insert: jest.fn(),
      updateOwned: jest.fn(),
      removeOwned: jest.fn(),
    };
    userService = {
      findOne: jest.fn(),
    };
    letterService = {
      findOwnedOne: jest.fn(),
    };

    controller = new ContactController(
      contactService as any,
      userService as any,
      letterService as any,
    );
  });

  it('returns current user contacts', async () => {
    contactService.findByUser.mockResolvedValue([
      {
        uuid: 'contact-1',
        user: { password: 'never-expose', auths: [{ token: 'secret' }] },
        extra: { secret: true },
        id: 123,
      },
    ]);

    await expect(controller.query({ user: { uuid: 'user-1' } } as any)).resolves.toEqual([
      { uuid: 'contact-1' },
    ]);
  });

  it('rejects create without name', async () => {
    await expect(
      controller.create({ name: '   ', email: 'alice@example.com' }, {
        user: { uuid: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects create without any contact method', async () => {
    await expect(
      controller.create({ name: 'Alice', email: '   ', phone: '   ' }, {
        user: { uuid: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects create when referenced letters are not owned', async () => {
    userService.findOne.mockResolvedValue({ uuid: 'user-1' });
    letterService.findOwnedOne.mockResolvedValue(null);

    await expect(
      controller.create(
        {
          name: 'Alice',
          email: 'alice@example.com',
          letterUuids: ['letter-1'],
        },
        { user: { uuid: 'user-1' } } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a normalized contact payload', async () => {
    const user = { uuid: 'user-1' };
    const letter = { uuid: 'letter-1' };
    const created = { uuid: 'contact-1' };

    userService.findOne.mockResolvedValue(user);
    letterService.findOwnedOne.mockResolvedValue(letter);
    contactService.insert.mockResolvedValue(created);

    await expect(
      controller.create(
        {
          name: ' Alice ',
          email: ' alice@example.com ',
          phone: ' 123 ',
          note: ' friend ',
          letterUuids: ['letter-1', 'letter-1'],
        },
        { user } as any,
      ),
    ).resolves.toEqual(created);

    expect(contactService.insert).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '123',
      note: 'friend',
      user,
      letters: [letter],
    });
  });

  it('rejects update when resulting contact methods are empty', async () => {
    contactService.findOwnedOne.mockResolvedValue({
      uuid: 'contact-1',
      email: 'alice@example.com',
      phone: '123',
    });

    await expect(
      controller.update('contact-1', { email: '   ', phone: '   ' }, {
        user: { uuid: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects removing a missing contact', async () => {
    contactService.findOwnedOne.mockResolvedValue(null);

    await expect(
      controller.remove('contact-1', { user: { uuid: 'user-1' } } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
