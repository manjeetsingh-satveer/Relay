export class RelayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.status = status;
  }
}

export function isRelayError(error: unknown): error is RelayError {
  return error instanceof RelayError;
}
