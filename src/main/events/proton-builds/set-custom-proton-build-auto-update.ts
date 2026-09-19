import { registerEvent } from "../register-event";
import { customProtonBuilds } from "@main/services";
import type { CustomProtonBuildId } from "@types";

const setCustomProtonBuildAutoUpdate = async (
  _event: Electron.IpcMainInvokeEvent,
  buildId: CustomProtonBuildId,
  enabled: boolean
) => customProtonBuilds.setCustomProtonBuildAutoUpdate(buildId, enabled);

registerEvent("setCustomProtonBuildAutoUpdate", setCustomProtonBuildAutoUpdate);
