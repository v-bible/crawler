/* eslint-disable no-continue */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-restricted-syntax */
import { randomUUID } from 'node:crypto';
import { type Logger } from 'winston';
import { GetDefaultDocumentPathFunction } from '@/lib/crawler/fileUtils';
import { logger } from '@/logger/logger';

export type WorkerHandler<TData, TOutput> = {
  handler: {
    fn: (params: TData) => Promise<TOutput> | TOutput;
    onStart?: (params: TData, log?: Logger) => void;
    onFinish?: (params: TOutput, log?: Logger) => void;
    onError?: (error: Error, log?: Logger) => void;
  };
  stringify?: {
    name: string;
    fn: (
      data: TOutput,
      options?: object,
      log?: Logger,
    ) => {
      content: string | Buffer;
      extension: string;
    };
    stringifyOptions?: object;
    onStart?: (params: TOutput, log?: Logger) => void;
    onFinish?: (
      content: string | Buffer,
      fileName: string,
      getFileName?: GetDefaultDocumentPathFunction,
      log?: Logger,
    ) => void;
    onError?: (error: Error, log?: Logger) => void;
    getFileName?: GetDefaultDocumentPathFunction;
  }[];
  onStringifyStart?: (log?: Logger) => void;
  onStringifyFinish?: (log?: Logger) => void;
  onStringifyError?: (error: Error, log?: Logger) => void;
};

export type WorkerHandlerFn<TData, TOutput> = WorkerHandler<
  TData,
  TOutput
>['handler']['fn'];

type WorkerArgs<TData> = {
  workerId: string;
  shardIndex: number;
  handlers: WorkerHandler<TData, any>[];
  onWorkerStart?: (workerId: string) => void;
  onWorkerFinish?: (workerId: string) => void;
};

export function defineHandler<TData, TOutput>(
  config: WorkerHandler<TData, TOutput>,
): WorkerHandler<TData, TOutput> {
  return config;
}

export class Worker<TData> {
  workerId: string;

  type: 'worker';

  shardIndex: number;

  log: Logger;

  handlers: WorkerHandler<TData, unknown>[];

  onWorkerStart?: (workerId: string) => void;

  onWorkerFinish?: (workerId: string) => void;

  constructor(args: Omit<WorkerArgs<TData>, 'workerId'>) {
    this.workerId = randomUUID();
    this.type = 'worker';
    this.shardIndex = args.shardIndex;
    this.log = logger.child({
      id: this.workerId,
      type: this.type,
      shardIndex: this.shardIndex,
    });
    this.handlers = args.handlers;
    this.onWorkerStart = args.onWorkerStart;
    this.onWorkerFinish = args.onWorkerFinish;
  }

  getId() {
    return this.workerId;
  }

  async run(data: TData) {
    if (this.onWorkerStart) {
      this.onWorkerStart(this.workerId);
    }

    for await (const handler of this.handlers) {
      const { handler: handlerFn, stringify: stringifyFn } = handler;

      if (handlerFn.onStart) {
        handlerFn.onStart(data, this.log);
      }

      try {
        const result = await handlerFn.fn(data);

        if (handlerFn.onFinish) {
          handlerFn.onFinish(result, this.log);
        }

        if (result !== undefined) {
          if (handler.onStringifyStart) {
            handler.onStringifyStart(this.log);
          }
          try {
            for await (const {
              name,
              stringifyOptions,
              fn,
              onStart,
              onFinish,
              onError,
              getFileName,
            } of stringifyFn || []) {
              if (onStart) {
                onStart(result, this.log);
              }

              try {
                const { content, extension } = fn(
                  result,
                  stringifyOptions,
                  this.log.child({ name }),
                );

                if (onFinish) {
                  onFinish(
                    content,
                    extension,
                    getFileName,
                    this.log.child({ name }),
                  );
                }
              } catch (error) {
                if (onError) {
                  onError(error as Error, this.log.child({ name }));
                }
                continue;
              }
            }

            if (handler.onStringifyFinish) {
              handler.onStringifyFinish(this.log);
            }
          } catch (error) {
            if (handler.onStringifyError) {
              handler.onStringifyError(error as Error, this.log);
            }
          }
        }
      } catch (error) {
        if (handlerFn.onError) {
          handlerFn.onError(error as Error, this.log);
        }
        continue;
      }
    }

    if (this.onWorkerFinish) {
      this.onWorkerFinish(this.workerId);
    }
  }
}
