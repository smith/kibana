/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

type SnakeToCamelCaseString<S extends string> = S extends `${infer T}_${infer U}`
  ? `${T}${Capitalize<SnakeToCamelCaseString<U>>}`
  : S;

type SnakeToCamelCaseArray<T> = T extends Array<infer ArrayItem>
  ? Array<SnakeToCamelCase<ArrayItem>>
  : T;

export type SnakeToCamelCase<T> = T extends Record<string, unknown>
  ? {
      [K in keyof T as SnakeToCamelCaseString<K & string>]: SnakeToCamelCase<T[K]>;
    }
  : T extends unknown[]
  ? SnakeToCamelCaseArray<T>
  : T;

export enum CASE_VIEW_PAGE_TABS {
  ALERTS = 'alerts',
  ACTIVITY = 'activity',
  FILES = 'files',
  OBSERVABLES = 'observables',
  SIMILAR_CASES = 'similar_cases',
}
