import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { Public } from 'src/auth/auth.decorator';
import { Self } from 'src/permission/permission.decorator';
import { ResourceService, UploadedResource } from './resource.service';

@Controller('resource')
export class ResourceController {
  constructor(private readonly resources: ResourceService) {}

  @Self()
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Req() request: Request, @UploadedFile() file?: UploadedResource) {
    return this.resources.upload(request.user.uuid, file);
  }

  @Self()
  @Get(':uuid/access')
  access(@Param('uuid', new ParseUUIDPipe()) uuid: string, @Req() request: Request) {
    return this.resources.ownerAccess(uuid, request.user.uuid);
  }

  @Public()
  @Get(':uuid/file')
  async download(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ): Promise<void> {
    const { resource, stream } = await this.resources.openSigned(uuid, Number(expires), signature);
    response.setHeader('Content-Type', resource.mimeType);
    response.setHeader('Content-Length', String(resource.sizeBytes));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader(
      'Content-Disposition',
      `${resource.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(resource.filename).replace(/'/g, '%27')}`,
    );
    stream.on('error', () => response.destroy());
    response.once('close', () => stream.destroy());
    stream.pipe(response);
  }
}
