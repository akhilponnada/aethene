/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as chunks from "../chunks.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as entities from "../entities.js";
import type * as memories from "../memories.js";
import type * as memoryLinks from "../memoryLinks.js";
import type * as memoryOps from "../memoryOps.js";
import type * as settings from "../settings.js";
import type * as vectorSearch from "../vectorSearch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  chunks: typeof chunks;
  content: typeof content;
  crons: typeof crons;
  entities: typeof entities;
  memories: typeof memories;
  memoryLinks: typeof memoryLinks;
  memoryOps: typeof memoryOps;
  settings: typeof settings;
  vectorSearch: typeof vectorSearch;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
