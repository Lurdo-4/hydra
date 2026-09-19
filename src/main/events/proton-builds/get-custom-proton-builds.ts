import { registerEvent } from "../register-event";
import { customProtonBuilds } from "@main/services";

const getCustomProtonBuilds = async () =>
  customProtonBuilds.getCustomProtonBuildStatuses();

registerEvent("getCustomProtonBuilds", getCustomProtonBuilds);
