import { registerEvent } from "../register-event";
import { Umu, customProtonBuilds } from "@main/services";
import type { CustomProtonBuildId } from "@types";

interface ManagedInstallInfo {
  buildId: CustomProtonBuildId;
  version: string;
  trackingLatest: boolean;
}

const getInstalledProtonVersions = async () => {
  const [versions, records] = await Promise.all([
    Umu.getInstalledProtonVersions(),
    customProtonBuilds.getAllCustomProtonBuildRecords(),
  ]);

  const pathToManagedInstall = new Map<string, ManagedInstallInfo>();
  for (const [buildId, record] of records) {
    for (const install of record.installs) {
      pathToManagedInstall.set(install.path, {
        buildId,
        version: install.version,
        trackingLatest: install.trackingLatest,
      });
    }
  }

  return versions.map((version) => {
    const managedInstall = pathToManagedInstall.get(version.path);
    if (!managedInstall) return version;

    const catalogEntry = customProtonBuilds.findCatalogEntry(
      managedInstall.buildId
    );
    const baseName = catalogEntry?.name ?? version.name;

    return {
      ...version,
      managedBuildId: managedInstall.buildId,
      name: managedInstall.trackingLatest
        ? `${baseName} (${managedInstall.version}, latest)`
        : `${baseName} (${managedInstall.version})`,
    };
  });
};

registerEvent("getInstalledProtonVersions", getInstalledProtonVersions);
