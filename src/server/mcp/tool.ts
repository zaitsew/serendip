import type { z } from "zod";

/** A tool is a plain object. No tool deletes, buys or calls a model; each reads or writes the owner's own store. */

/** Thrown by a handler; becomes `{ error, detail }` with `isError: true`. */
export class ToolError extends Error {
  constructor(public code: string, public detail?: string) {
    super(code);
  }
}

export interface ToolHints { readOnly: boolean; destructive: boolean; idempotent: boolean; openWorld: boolean }

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  hints: ToolHints;
  handler: (args: z.output<S>) => unknown | Promise<unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;

export function defineTool<S extends z.ZodType>(tool: ToolDef<S>): ToolDef<S> {
  return tool;
}
