import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  statusCode: HttpStatus;
  message: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    const statusCode = context.switchToHttp().getResponse().statusCode;
    const message =
      statusCode >= HttpStatus.OK && statusCode < HttpStatus.BAD_REQUEST ? 'success' : 'failed';
    return next.handle().pipe(
      map((data) => {
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (error) {
            return { message, data, statusCode };
          }
        }
        return { message, data, statusCode };
      }),
    );
  }
}
