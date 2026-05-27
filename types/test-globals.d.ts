declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void | Promise<void>) => void;
declare const beforeEach: (fn: () => void | Promise<void>) => void;

type GenericMatcher = (...args: any[]) => any;
type MatcherBag = {
  toBe: GenericMatcher;
  toEqual: GenericMatcher;
  toBeNull: GenericMatcher;
  toBeUndefined: GenericMatcher;
  [key: string]: GenericMatcher;
};

declare function expect(actual: any): MatcherBag;
