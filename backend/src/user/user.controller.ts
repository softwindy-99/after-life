import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  BadRequestException,
  NotAcceptableException,
  Req,
  Put,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UserService } from './user.service';
import { Public } from 'src/auth/auth.decorator';
import { toUserDto, UserDto } from './user.dto';
import { parseInput } from 'src/validation';
import {
  adminNewUserSchema,
  adminUpdateUserSchema,
  newUserSchema,
  updateUserSchema,
  userListSchema,
  userQuerySchema,
} from './user.schema';
import { Permission, Self } from 'src/permission/permission.decorator';
import { UpdateResult } from 'typeorm';
import { Request } from 'express';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Self()
  async query(
    @Query() queryUser: { uuid?: string },
    @Req() request: Request,
  ): Promise<UserDto | null> {
    queryUser = parseInput(userQuerySchema, queryUser);
    const currentUserUuid = request.user.uuid;
    const requestedUuid = queryUser.uuid || currentUserUuid;
    if (requestedUuid !== currentUserUuid) {
      throw new NotAcceptableException('you can only query your own information');
    }
    const user = await this.userService.findOne({ uuid: requestedUuid, iSdelete: 0 });
    return user ? toUserDto(user) : null;
  }

  @Permission('admin')
  @Get('list')
  async queryList(
    @Query()
    query: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      roleUuid?: string;
    },
  ) {
    const options = parseInput(userListSchema, query);
    const result = await this.userService.findAdminList({
      ...options,
      page: options.page,
      pageSize: options.pageSize,
    });
    return { data: result.data.map(toUserDto), total: result.total };
  }

  @Public()
  @Post()
  async create(@Body() input: unknown): Promise<UserDto> {
    const createUser = parseInput(newUserSchema, input);
    const userExist = await this.userService.findOne({
      email: createUser.email,
    });
    if (userExist) throw new BadRequestException('email already exists');
    const user = await this.userService.create({
      username: createUser.username,
      email: createUser.email,
      password: createUser.password,
      avatar: createUser.avatar,
    });
    return toUserDto(user);
  }

  @Permission('admin')
  @Post('admin')
  async createByAdmin(@Body() createUser: unknown): Promise<UserDto> {
    const { username, email, password, roleUuid, avatar } = parseInput(
      adminNewUserSchema,
      createUser,
    );

    const userExist = await this.userService.findOne({ email });
    if (userExist) throw new BadRequestException('email already exists');

    const user = await this.userService.createByAdmin({
      username,
      email,
      password,
      roleUuid,
      avatar,
    });
    return toUserDto(user);
  }

  // 非管理员用户只能修改自己的信息
  @Put()
  @Self()
  async update(
    @Body()
    updateUser: {
      uuid?: string;
      username?: string;
      email?: string;
      password?: string;
      avatar?: string | null;
    },
    @Req() request: Request,
  ): Promise<UpdateResult> {
    const payload = parseInput(updateUserSchema, updateUser);

    return this.userService.update(request.user.uuid, payload);
  }

  @Get('avatar')
  @Self()
  async queryAvatar(@Req() request: Request): Promise<{ avatar: string | null }> {
    return {
      avatar: await this.userService.findAvatar(request.user.uuid),
    };
  }

  @Permission('admin')
  @Get('admin/:uuid/avatar')
  async queryAvatarByAdmin(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
  ): Promise<{ avatar: string | null }> {
    return {
      avatar: await this.userService.findAvatar(uuid),
    };
  }

  @Permission('admin')
  @Put('admin/:uuid')
  async updateByAdmin(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body()
    updateUser: {
      username?: string;
      email?: string;
      password?: string;
      avatar?: string;
      roleUuid?: string;
    },
  ): Promise<UserDto> {
    const updated = await this.userService.updateByAdmin(
      uuid,
      parseInput(adminUpdateUserSchema, updateUser),
    );
    if (!updated) throw new NotFoundException('user not found');
    return toUserDto(updated);
  }
}
