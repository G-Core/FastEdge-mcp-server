import type { Workflow } from "./types.js";
import { createApp } from "./fastedge/create-app.js";
import { updateAppBinary } from "./fastedge/update-app-binary.js";
import { deleteAppAndBinary } from "./fastedge/delete-app-and-binary.js";

export const workflows: Record<string, Workflow> = {
  [createApp.name]: createApp,
  [updateAppBinary.name]: updateAppBinary,
  [deleteAppAndBinary.name]: deleteAppAndBinary,
};
