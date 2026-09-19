import { db } from "../level";
import { levelKeys } from "./keys";
import type { CustomProtonBuildId, CustomProtonBuildRecord } from "@types";

export const customProtonBuildsSublevel = db.sublevel<
  CustomProtonBuildId,
  CustomProtonBuildRecord
>(levelKeys.customProtonBuilds, {
  valueEncoding: "json",
});
