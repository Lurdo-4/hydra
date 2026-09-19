import { registerEvent } from "../register-event";
import { customProtonBuilds } from "@main/services";
import type { CustomProtonBuildId } from "@types";

const getCustomProtonBuildVersions = async (
  _event: Electron.IpcMainInvokeEvent,
  buildId: CustomProtonBuildId,
  page?: number
) => customProtonBuilds.listCustomProtonBuildVersions(buildId, page ?? 1);

registerEvent("getCustomProtonBuildVersions", getCustomProtonBuildVersions);
