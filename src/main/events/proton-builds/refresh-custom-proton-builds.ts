import { registerEvent } from "../register-event";
import { customProtonBuilds } from "@main/services";

const refreshCustomProtonBuilds = async () =>
  customProtonBuilds.refreshCustomProtonBuildAvailability();

registerEvent("refreshCustomProtonBuilds", refreshCustomProtonBuilds);
