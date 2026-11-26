import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { McpActionsService } from './mcp-actions.service';

// Authenticate before Multer buffers file bytes. Revalidate again after upload.
@Injectable()
export class McpUploadGuard implements CanActivate {
  constructor(private readonly actions: McpActionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [type, ticket] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !ticket) throw new ForbiddenException('upload ticket required');
    await this.actions.validateUploadTicket(ticket);
    return true;
  }
}
