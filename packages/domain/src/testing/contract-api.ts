/**
 * The minimal test-framework surface a contract suite needs. The binding test file
 * injects it (bun:test for the memory adapters, vitest-pool-workers for production
 * adapters) because the domain layer depends on no test runner directly.
 */
export interface ContractExpectation {
  readonly toBe: (expected: unknown) => void;
  readonly toBeNull: () => void;
  readonly toEqual: (expected: unknown) => void;
}

export interface ContractTestApi {
  readonly describe: (name: string, body: () => void) => void;
  readonly expect: (actual: unknown) => ContractExpectation;
  readonly test: (name: string, body: () => Promise<void>) => void;
}
