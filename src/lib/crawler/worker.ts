/* eslint-disable no-continue */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-restricted-syntax */
import { randomUUID } from 'node:crypto';
import { type Logger } from 'winston';
import { DEFAULT_TIMEOUT } from '@/constants';
import { withTimeout } from '@/lib/timeout';
import { logger } from '@/logger/logger';

export type GetFileNameFunction<
  TParams extends {
    extension: string;
    documentTitle?: string;
    suffix?: string;
  },
> = (params: TParams) => string;

export type WorkerHandler<TData, TOutput, TMeta> = {
  handler: {
    name: string;
    fn: (
      params: TData,
      metadata: TMeta,
      signal?: AbortSignal,
    ) => Promise<TOutput> | TOutput;
    timeoutMs?: number;
    onStart?: (params: TData, log?: Logger) => void;
    onFinish?: (params: TOutput, log?: Logger) => void;
    onError?: (error: Error, log?: Logger) => void;
    output?: {
      extension: string;
      getFileName: GetFileNameFunction<any>;
      suffix?: string;
      allowMissing?: boolean;
    };
  };
  stringify?: {
    name: string;
    fn: (data: TOutput, options?: object, log?: Logger) => string | Buffer;
    stringifyOptions?: object;
    onStart?: (params: TOutput, log?: Logger) => void;
    onFinish?: (content: string | Buffer, log?: Logger) => void;
    onError?: (error: Error, log?: Logger) => void;
    output?: {
      extension: string;
      getFileName: GetFileNameFunction<any>;
      suffix?: string;
      allowMissing?: boolean;
    };
  }[];
  onStringifyStart?: (log?: Logger) => void;
  onStringifySuccess?: (log?: Logger) => void;
  onStringifyFinish?: (log?: Logger) => void;
  onStringifyError?: (error: Error, log?: Logger) => void;
};

export type WorkerHandlerFn<TData, TOutput, TMeta> = WorkerHandler<
  TData,
  TOutput,
  TMeta
>['handler']['fn'];

type WorkerArgs<TData, TMeta> = {
  workerId?: string; // Made optional so randomUUID works correctly if not provided
  shardIndex?: number;
  handlers: WorkerHandler<TData, any, TMeta>[];
  onWorkerStart?: (workerId: string) => void;
  onWorkerSuccess?: (workerId: string) => void;
  onWorkerFinish?: (workerId: string) => void;
  onWorkerError?: (error: Error, workerId: string) => void;
};

export function defineHandler<TData, TOutput, TMeta>(
  config: WorkerHandler<TData, TOutput, TMeta>,
): WorkerHandler<TData, TOutput, TMeta> {
  return config;
}

export function defineGetFileNameFunction<
  TParams extends {
    extension: string;
    documentTitle?: string;
    suffix?: string;
  },
>(fn: GetFileNameFunction<TParams>): GetFileNameFunction<TParams> {
  return fn;
}

export class Worker<TData, TMeta> {
  workerId: string;

  type: 'worker';

  shardIndex?: number;

  log: Logger;

  handlers: WorkerHandler<TData, any, TMeta>[];

  isWorkerSuccess: boolean = true;

  onWorkerStart?: (workerId: string) => void;

  onWorkerSuccess?: (workerId: string) => void;

  onWorkerFinish?: (workerId: string) => void;

  onWorkerError?: (error: Error, workerId: string) => void;

  constructor(
    args: Omit<WorkerArgs<TData, TMeta>, 'workerId'> & { workerId?: string },
  ) {
    this.workerId = args.workerId || randomUUID();
    this.type = 'worker';
    this.shardIndex = args.shardIndex;
    this.log = logger.child({
      shardIndex: this.shardIndex,
    });
    this.handlers = args.handlers;
    this.onWorkerStart = args.onWorkerStart;
    this.onWorkerSuccess = args.onWorkerSuccess;
    this.onWorkerFinish = args.onWorkerFinish;
  }

  getId() {
    return this.workerId;
  }

  async run(data: TData, metadata: TMeta) {
    if (this.onWorkerStart) {
      this.onWorkerStart(this.workerId);
    }

    try {
      for await (const handler of this.handlers) {
        const { handler: handlerFn, stringify: stringifyFn } = handler;

        if (handlerFn.onStart) {
          handlerFn.onStart(data, this.log);
        }

        try {
          // 3. Wrap the core handler execution in the timeout utility
          const result = await withTimeout(
            async (signal) => handlerFn.fn(data, metadata, signal),
            handlerFn.timeoutMs || DEFAULT_TIMEOUT,
          );

          if (handlerFn.onFinish) {
            handlerFn.onFinish(result, this.log);
          }

          if (result !== undefined) {
            if (handler.onStringifyStart) {
              handler.onStringifyStart(this.log);
            }
            try {
              let isStringifySuccess = true;

              for await (const {
                name,
                stringifyOptions,
                fn,
                onStart,
                onFinish,
                onError,
              } of stringifyFn || []) {
                if (onStart) {
                  onStart(result, this.log);
                }

                try {
                  const content = fn(
                    result,
                    stringifyOptions,
                    this.log.child({ name }),
                  );

                  if (onFinish) {
                    onFinish(content, this.log.child({ name }));
                  }
                } catch (error) {
                  if (onError) {
                    onError(error as Error, this.log.child({ name }));
                  }

                  isStringifySuccess = false;

                  continue;
                }
              }

              if (handler.onStringifyFinish) {
                handler.onStringifyFinish(this.log);
              }

              if (isStringifySuccess) {
                if (handler.onStringifySuccess) {
                  handler.onStringifySuccess(this.log);
                }
              } else {
                throw new Error('One or more stringify operations failed');
              }
            } catch (error) {
              if (handler.onStringifyError) {
                handler.onStringifyError(error as Error, this.log);
              }

              throw error; // Re-throw to be caught by the outer try-catch
            }
          }
        } catch (error) {
          // 4. Timeouts will now be caught here alongside standard execution errors
          if (handlerFn.onError) {
            handlerFn.onError(error as Error, this.log);
          }

          this.isWorkerSuccess = false;

          continue; // Proceed to the next handler if this one fails
        }
      }

      if (this.onWorkerFinish) {
        this.onWorkerFinish(this.workerId);
      }

      if (this.isWorkerSuccess) {
        if (this.onWorkerSuccess) {
          this.onWorkerSuccess(this.workerId);
        }
      } else {
        throw new Error('One or more handlers failed during execution');
      }
    } catch (error) {
      if (this.onWorkerError) {
        this.onWorkerError(error as Error, this.workerId);
      }
    }
  }
}
