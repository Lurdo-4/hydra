import { registerEvent } from "../register-event";
import { customProtonBuilds } from "@main/services";
import type { CustomProtonBuildId } from "@types";

const installCustomProtonBuild = async (
  _event: Electron.IpcMainInvokeEvent,
  buildId: CustomProtonBuildId,
  version?: string
) =>
  customProtonBuilds.downloadAndInstallCustomProtonBuild(
    buildId,
    version ?? undefined
  );

registerEvent("installCustomProtonBuild", installCustomProtonBuild);
