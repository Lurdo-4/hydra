import fs from "node:fs";
import path from "node:path";

import type {
  CustomProtonBuildId,
  CustomProtonBuildInstall,
  CustomProtonBuildInstallProgress,
  CustomProtonBuildInstallResult,
  CustomProtonBuildRecord,
  CustomProtonBuildStatus,
  CustomProtonBuildVersionsPage,
  UserPreferences,
} from "@types";
import { customProtonBuildsSublevel, db, levelKeys } from "@main/level";

import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { SystemPath } from "../system-path";
import { WindowManager } from "../window-manager";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { Umu } from "../umu";
import { publishCustomProtonBuildUpdatedNotification } from "../notifications";
import {
  CUSTOM_PROTON_BUILD_CATALOG,
  findCatalogEntry,
  fetchCustomProtonBuildVersionsPage,
  resolveAllCustomProtonBuildOptions,
  resolveCustomProtonBuildOption,
  resolveCustomProtonBuildOptionForVersion,
} from "./proton-build-sources";

const installsInProgress = new Set<CustomProtonBuildId>();

const sendProgress = (progress: CustomProtonBuildInstallProgress): void => {
  WindowManager.sendToAppWindows(
    "on-custom-proton-build-install-progress",
    progress
  );
};

export const getCompatibilityToolsDirectory = (): string =>
  path.join(
    SystemPath.getPath("home"),
    ".steam",
    "steam",
    "compatibilitytools.d"
  );

const getRealCompatibilityToolsDirectory = async (): Promise<string> => {
  const directory = getCompatibilityToolsDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  return fs.promises.realpath(directory);
};

const getEmptyRecord = (): CustomProtonBuildRecord => ({
  installs: [],
  autoUpdate: false,
  lastCheckedAt: null,
});

interface LegacyCustomProtonBuildRecord {
  installedVersion?: string | null;
  installedPath?: string | null;
  pinnedVersion?: string | null;
  autoUpdate?: boolean;
  lastCheckedAt?: string | null;
  installs?: CustomProtonBuildInstall[];
}

const dedupeInstallsByVersion = (
  installs: CustomProtonBuildInstall[]
): CustomProtonBuildInstall[] => {
  const byVersion = new Map<string, CustomProtonBuildInstall>();
  for (const install of installs) {
    const existing = byVersion.get(install.version);
    byVersion.set(install.version, {
      ...install,
      trackingLatest:
        install.trackingLatest || (existing?.trackingLatest ?? false),
    });
  }
  return Array.from(byVersion.values());
};

const normalizeRecord = (
  raw: LegacyCustomProtonBuildRecord | null
): CustomProtonBuildRecord => {
  if (!raw) return getEmptyRecord();
  if (Array.isArray(raw.installs)) {
    return {
      installs: dedupeInstallsByVersion(raw.installs),
      autoUpdate: raw.autoUpdate ?? false,
      lastCheckedAt: raw.lastCheckedAt ?? null,
    };
  }

  const installs: CustomProtonBuildInstall[] =
    raw.installedVersion && raw.installedPath
      ? [
          {
            version: raw.installedVersion,
            path: raw.installedPath,
            trackingLatest: !raw.pinnedVersion,
          },
        ]
      : [];

  return {
    installs,
    autoUpdate: raw.autoUpdate ?? false,
    lastCheckedAt: raw.lastCheckedAt ?? null,
  };
};

const getRecord = async (
  buildId: CustomProtonBuildId
): Promise<CustomProtonBuildRecord> => {
  const raw = (await customProtonBuildsSublevel
    .get(buildId)
    .catch(() => null)) as LegacyCustomProtonBuildRecord | null;
  return normalizeRecord(raw);
};

export const getAllCustomProtonBuildRecords = async (): Promise<
  [CustomProtonBuildId, CustomProtonBuildRecord][]
> => {
  const entries = await customProtonBuildsSublevel.iterator().all();
  return Promise.all(
    entries.map(
      async ([buildId]) =>
        [buildId, await getRecord(buildId)] as [
          CustomProtonBuildId,
          CustomProtonBuildRecord,
        ]
    )
  );
};

const isPathUnderCompatibilityTools = async (
  candidatePath: string
): Promise<boolean> => {
  const realCompatibilityToolsDir = await getRealCompatibilityToolsDirectory();
  const relative = path.relative(realCompatibilityToolsDir, candidatePath);
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
};

const findExtractedProtonDirectory = async (
  extractDir: string
): Promise<string | null> => {
  if (Umu.isValidProtonPath(extractDir)) return extractDir;

  const entries = await fs.promises.readdir(extractDir, {
    withFileTypes: true,
  });
  const directories = entries.filter((entry) => entry.isDirectory());

  for (const entry of directories) {
    const candidate = path.join(extractDir, entry.name);
    if (Umu.isValidProtonPath(candidate)) return candidate;
  }

  return null;
};

const moveDirectory = async (source: string, destination: string) => {
  await fs.promises.rm(destination, { recursive: true, force: true });

  try {
    await fs.promises.rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;

    await fs.promises.cp(source, destination, { recursive: true });
    await fs.promises.rm(source, { recursive: true, force: true });
  }
};

const clearDefaultProtonPathIfMatches = async (protonPath: string) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (userPreferences?.defaultProtonPath !== protonPath) return;

  const updatedPreferences: UserPreferences = {
    ...userPreferences,
    defaultProtonPath: null,
  };

  await db.put(levelKeys.userPreferences, updatedPreferences, {
    valueEncoding: "json",
  });

  WindowManager.sendToAppWindows(
    "on-user-preferences-updated",
    updatedPreferences
  );
};

const removeManagedDirectory = async (
  directoryPath: string | null
): Promise<void> => {
  if (!directoryPath) return;
  if (!(await isPathUnderCompatibilityTools(directoryPath))) return;

  await clearDefaultProtonPathIfMatches(directoryPath);
  await fs.promises.rm(directoryPath, { recursive: true, force: true });
};

export const downloadAndInstallCustomProtonBuild = async (
  buildId: CustomProtonBuildId,
  version?: string
): Promise<CustomProtonBuildInstallResult> => {
  const entry = findCatalogEntry(buildId);
  if (!entry) return { ok: false, reason: "unknown_build" };
  if (version && entry.kind === "link") {
    return { ok: false, reason: "unknown_build" };
  }

  if (installsInProgress.has(buildId)) {
    return { ok: false, reason: "install_in_progress" };
  }

  installsInProgress.add(buildId);

  try {
    const option =
      version && entry.kind !== "link"
        ? await resolveCustomProtonBuildOptionForVersion(entry, version)
        : await resolveCustomProtonBuildOption(entry);

    if (option.kind === "link" || !option.downloadUrl || !option.version) {
      sendProgress({
        buildId,
        phase: "error",
        reason: "option_not_installable",
      });
      return { ok: false, reason: "option_not_installable" };
    }

    const fileName = path.basename(option.fileName ?? option.downloadUrl);
    const tempArchivePath = path.join(SystemPath.getPath("temp"), fileName);
    const tempExtractDir = path.join(
      SystemPath.getPath("temp"),
      `hydra-proton-build-${buildId}`
    );

    try {
      sendProgress({ buildId, phase: "downloading", loaded: 0 });
      await downloadToFile(
        option.downloadUrl,
        tempArchivePath,
        (loaded, total) => {
          sendProgress({
            buildId,
            phase: "downloading",
            loaded,
            total: total ?? undefined,
          });
        }
      );

      sendProgress({ buildId, phase: "extracting" });
      await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
      await SevenZip.extractFile({
        filePath: tempArchivePath,
        outputPath: tempExtractDir,
      });

      const extractedProtonDir =
        await findExtractedProtonDirectory(tempExtractDir);

      if (!extractedProtonDir) {
        sendProgress({
          buildId,
          phase: "error",
          reason: "invalid_archive_layout",
        });
        return { ok: false, reason: "invalid_archive_layout" };
      }

      const previousRecord = await getRecord(buildId);
      const realCompatibilityToolsDir =
        await getRealCompatibilityToolsDirectory();
      const destinationFolderName =
        extractedProtonDir === tempExtractDir
          ? `${entry.name}-${option.version}`
          : path.basename(extractedProtonDir);
      const destinationDir = path.join(
        realCompatibilityToolsDir,
        destinationFolderName
      );

      await moveDirectory(extractedProtonDir, destinationDir);
      const realDestinationDir = await fs.promises.realpath(destinationDir);

      const isTrackingLatest = !version;
      const newInstall: CustomProtonBuildInstall = {
        version: option.version,
        path: realDestinationDir,
        trackingLatest: isTrackingLatest,
      };

      const supersededInstalls = previousRecord.installs.filter(
        (install) =>
          install.version === newInstall.version ||
          (isTrackingLatest && install.trackingLatest)
      );
      const remainingInstalls = previousRecord.installs.filter(
        (install) => !supersededInstalls.includes(install)
      );

      const record: CustomProtonBuildRecord = {
        installs: [...remainingInstalls, newInstall],
        autoUpdate: previousRecord.autoUpdate,
        lastCheckedAt: new Date().toISOString(),
      };
      await customProtonBuildsSublevel.put(buildId, record);

      sendProgress({
        buildId,
        phase: "done",
        version: option.version,
      });
      WindowManager.sendToAppWindows("on-custom-proton-build-updated", {
        buildId,
        version: option.version,
      });

      for (const superseded of supersededInstalls) {
        if (superseded.path === realDestinationDir) continue;
        await removeManagedDirectory(superseded.path).catch((error) =>
          logger.warn(`Failed to clean up previous ${buildId} install`, error)
        );
      }

      return {
        ok: true,
        path: realDestinationDir,
        version: option.version,
      };
    } finally {
      await removeFileQuietly(tempArchivePath);
      await fs.promises
        .rm(tempExtractDir, { recursive: true, force: true })
        .catch(() => {});
    }
  } catch (error) {
    logger.error(`Failed to install custom Proton build ${buildId}`, error);
    sendProgress({ buildId, phase: "error", reason: "install_failed" });
    return { ok: false, reason: "install_failed" };
  } finally {
    installsInProgress.delete(buildId);
  }
};

export const checkForCustomProtonBuildUpdate = async (
  buildId: CustomProtonBuildId
): Promise<void> => {
  try {
    const entry = findCatalogEntry(buildId);
    if (!entry || entry.kind === "link") return;

    const record = await getRecord(buildId);
    if (!record.autoUpdate) return;

    const latestInstall = record.installs.find(
      (install) => install.trackingLatest
    );
    if (!latestInstall) return;

    const option = await resolveCustomProtonBuildOption(entry);
    if (option.kind === "link" || !option.version) return;
    if (option.version === latestInstall.version) {
      await customProtonBuildsSublevel.put(buildId, {
        ...record,
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    const result = await downloadAndInstallCustomProtonBuild(buildId);
    if (result.ok && result.version) {
      await publishCustomProtonBuildUpdatedNotification(
        entry.name,
        result.version
      ).catch((error) =>
        logger.warn("Failed to publish custom Proton build notification", error)
      );
    }
  } catch (error) {
    logger.error(`Error checking for ${buildId} update`, error);
  }
};

export const checkAllCustomProtonBuildUpdates = async (): Promise<void> => {
  for (const entry of CUSTOM_PROTON_BUILD_CATALOG) {
    await checkForCustomProtonBuildUpdate(entry.id);
  }
};

export const setCustomProtonBuildAutoUpdate = async (
  buildId: CustomProtonBuildId,
  enabled: boolean
): Promise<CustomProtonBuildRecord> => {
  const record = await getRecord(buildId);
  const updatedRecord: CustomProtonBuildRecord = {
    ...record,
    autoUpdate: enabled,
  };
  await customProtonBuildsSublevel.put(buildId, updatedRecord);
  return updatedRecord;
};

export const uninstallCustomProtonBuild = async (
  buildId: CustomProtonBuildId,
  version: string
): Promise<{ ok: boolean; reason?: string }> => {
  const record = await getRecord(buildId);
  const install = record.installs.find((item) => item.version === version);

  if (!install) {
    return { ok: false, reason: "not_installed" };
  }

  await removeManagedDirectory(install.path);

  await customProtonBuildsSublevel.put(buildId, {
    ...record,
    installs: record.installs.filter((item) => item.version !== version),
  });

  WindowManager.sendToAppWindows("on-custom-proton-build-updated", {
    buildId,
    version: null,
  });

  return { ok: true };
};

const buildStatus = (
  entry: (typeof CUSTOM_PROTON_BUILD_CATALOG)[number],
  record: CustomProtonBuildRecord,
  latestVersion: string | null,
  htmlUrl: string | null
): CustomProtonBuildStatus => ({
  id: entry.id,
  name: entry.name,
  repo: entry.repo,
  kind: entry.kind,
  htmlUrl,
  installs: record.installs.map((install) => ({
    version: install.version,
    path: install.path,
    trackingLatest: install.trackingLatest,
    updateAvailable: Boolean(
      install.trackingLatest &&
        latestVersion &&
        install.version !== latestVersion
    ),
  })),
  autoUpdate: record.autoUpdate,
  latestVersion,
  lastCheckedAt: record.lastCheckedAt,
});

export const getCustomProtonBuildStatuses = async (): Promise<
  CustomProtonBuildStatus[]
> =>
  Promise.all(
    CUSTOM_PROTON_BUILD_CATALOG.map(async (entry) => {
      const record = await getRecord(entry.id);
      return buildStatus(entry, record, null, null);
    })
  );

export const refreshCustomProtonBuildAvailability = async (): Promise<
  CustomProtonBuildStatus[]
> => {
  const options = await resolveAllCustomProtonBuildOptions();

  return Promise.all(
    CUSTOM_PROTON_BUILD_CATALOG.map(async (entry, index) => {
      const record = await getRecord(entry.id);
      const option = options[index];
      return buildStatus(entry, record, option.version, option.htmlUrl);
    })
  );
};

export const listCustomProtonBuildVersions = async (
  buildId: CustomProtonBuildId,
  page: number
): Promise<CustomProtonBuildVersionsPage> => {
  const entry = findCatalogEntry(buildId);
  if (!entry || entry.kind === "link") {
    return { versions: [], nextPage: null };
  }

  return fetchCustomProtonBuildVersionsPage(entry, page);
};
