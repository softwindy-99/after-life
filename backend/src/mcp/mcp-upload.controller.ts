import {
  Controller,
  Header,
  ForbiddenException,
  Req,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from 'src/auth/auth.decorator';
import { UploadedResource } from 'src/resource/resource.service';
import { McpActionsService } from './mcp-actions.service';
import { McpUploadGuard } from './mcp-upload.guard';
import { McpOriginGuard } from './mcp-origin.guard';

@Controller('mcp-files')
@Public()
@UseGuards(McpOriginGuard, McpUploadGuard)
export class McpUploadController {
  constructor(private readonly actions: McpActionsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Req() request: Request, @UploadedFile() file?: UploadedResource): Promise<object> {
    const [type, ticket] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !ticket) throw new ForbiddenException('upload ticket required');
    return this.actions.upload(ticket, file);
  }
}
