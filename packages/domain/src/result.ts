export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly error: E;
  readonly ok: false;
}

export type Result<T, E> = Err<E> | Ok<T>;
export type AsyncResult<T, E> = Promise<Result<T, E>>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ error, ok: false });
