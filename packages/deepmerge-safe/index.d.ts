// Adapted from deepmerge 4.3.1 (MIT).
declare function deepmerge<T>(x: Partial<T>, y: Partial<T>, options?: deepmerge.Options): T;
declare function deepmerge<T1, T2>(x: Partial<T1>, y: Partial<T2>, options?: deepmerge.Options): T1 & T2;
declare namespace deepmerge {
  interface Options {
    arrayMerge?(target: any[], source: any[], options?: ArrayMergeOptions): any[];
    clone?: boolean;
    customMerge?: (key: string, options?: Options) => ((x: any, y: any) => any) | undefined;
    isMergeableObject?(value: object): boolean;
  }
  interface ArrayMergeOptions {
    cloneUnlessOtherwiseSpecified(value: any, options?: Options): any;
    isMergeableObject(value: object): boolean;
  }
  function all(objects: object[], options?: Options): object;
  function all<T>(objects: Partial<T>[], options?: Options): T;
}
export = deepmerge;
