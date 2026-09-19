import { registerEvent } from "../register-event";
import { customProtonBuilds } from "@main/services";
import type { CustomProtonBuildId } from "@types";

const uninstallCustomProtonBuild = async (
  _event: Electron.IpcMainInvokeEvent,
  buildId: CustomProtonBuildId,
  version: string
) => customProtonBuilds.uninstallCustomProtonBuild(buildId, version);

registerEvent("uninstallCustomProtonBuild", uninstallCustomProtonBuild);
