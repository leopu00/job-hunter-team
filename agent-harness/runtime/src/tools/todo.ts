/**
 * The todo list: a plan the agent keeps, and the person can watch.
 *
 * The list lives in the session and changes nothing outside it. Its value is
 * attention: an agent that writes its steps down and ticks them off loses
 * fewer of them in a long turn, and a person watching sees where it is.
 * Every call replaces the whole list.
 */

import { z } from "zod";

import type { TodoItem } from "../core/agent-loop.ts";
import type { ToolHandler } from "./registry.ts";

export const TODO_TOOL = "todo_write";

const todoSchema = z
  .object({
    todos: z
      .array(
        z
          .object({
            content: z.string().min(1).max(200),
            status: z.enum(["pending", "in_progress", "completed"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
  .refine((value) => value.todos.filter((t) => t.status === "in_progress").length <= 1, {
    message: "At most one item can be in_progress.",
    path: ["todos"],
  });

export function createTodoTool(onUpdate: (todos: TodoItem[]) => void): ToolHandler {
  return {
    spec: {
      name: TODO_TOOL,
      description:
        "Write your plan as a todo list, replacing the previous one. Use it for work with three or " +
        "more steps: add the steps, mark one in_progress while you do it, completed as soon as it is " +
        "done. The person sees the list. Skip it for single questions and short answers.",
      schema: todoSchema,
    },

    classify(args) {
      const { todos } = args as { todos: TodoItem[] };
      return { risk: "none", paths: [], summary: `${todos.length} item${todos.length === 1 ? "" : "s"}` };
    },

    async execute(args) {
      const { todos } = args as { todos: TodoItem[] };
      onUpdate(todos.map((t) => ({ ...t })));
      const count = (status: TodoItem["status"]) => todos.filter((t) => t.status === status).length;
      return {
        ok: true,
        content:
          `Todo list updated: ${count("completed")} completed, ${count("in_progress")} in progress, ` +
          `${count("pending")} pending.`,
      };
    },
  };
}
