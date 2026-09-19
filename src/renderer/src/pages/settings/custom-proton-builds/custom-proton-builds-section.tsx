import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  DownloadIcon,
  SyncIcon,
  AlertIcon,
  LinkExternalIcon,
  TrashIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField, Link, SelectField } from "@renderer/components";
import type {
  CustomProtonBuildId,
  CustomProtonBuildInstallProgress,
  CustomProtonBuildStatus,
  CustomProtonBuildVersionOption,
} from "@types";
import { logger } from "@renderer/logger";

import "./custom-proton-builds-section.scss";

const LATEST_VERSION_VALUE = "latest";
const LOAD_MORE_VERSIONS_VALUE = "__load_more__";

interface VersionListState {
  options: CustomProtonBuildVersionOption[];
  nextPage: number | null;
  loading: boolean;
}

export interface CustomProtonBuildsSectionProps {
  onProtonVersionsChanged?: () => void;
}

export function CustomProtonBuildsSection({
  onProtonVersionsChanged,
}: Readonly<CustomProtonBuildsSectionProps>) {
  const { t } = useTranslation("settings");

  const [statuses, setStatuses] = useState<CustomProtonBuildStatus[]>([]);
  const [progress, setProgress] = useState<
    Partial<Record<CustomProtonBuildId, CustomProtonBuildInstallProgress>>
  >({});
  const [versionsByBuild, setVersionsByBuild] = useState<
    Partial<Record<CustomProtonBuildId, VersionListState>>
  >({});
  const [selectedVersionByBuild, setSelectedVersionByBuild] = useState<
    Partial<Record<CustomProtonBuildId, string>>
  >({});

  const loadStatuses = useCallback(async () => {
    const results = await window.electron.getCustomProtonBuilds();
    setStatuses(results);
    setSelectedVersionByBuild((prev) => {
      const next = { ...prev };
      for (const status of results) {
        if (!(status.id in next)) {
          next[status.id] = LATEST_VERSION_VALUE;
        }
      }
      return next;
    });
  }, []);

  const refreshAvailability = useCallback(async () => {
    try {
      const results = await window.electron.refreshCustomProtonBuilds();
      setStatuses(results);
    } catch (err) {
      logger.error(err);
    }
  }, []);

  const loadVersions = useCallback(
    async (buildId: CustomProtonBuildId, page: number) => {
      setVersionsByBuild((prev) => ({
        ...prev,
        [buildId]: {
          options: page === 1 ? [] : (prev[buildId]?.options ?? []),
          nextPage: prev[buildId]?.nextPage ?? null,
          loading: true,
        },
      }));

      try {
        const result = await window.electron.getCustomProtonBuildVersions(
          buildId,
          page
        );
        setVersionsByBuild((prev) => ({
          ...prev,
          [buildId]: {
            options: [
              ...(page === 1 ? [] : (prev[buildId]?.options ?? [])),
              ...result.versions,
            ],
            nextPage: result.nextPage,
            loading: false,
          },
        }));
      } catch (err) {
        logger.error(err);
        setVersionsByBuild((prev) => ({
          ...prev,
          [buildId]: {
            options: prev[buildId]?.options ?? [],
            nextPage: null,
            loading: false,
          },
        }));
      }
    },
    []
  );

  useEffect(() => {
    loadStatuses().then(() => refreshAvailability());
  }, [loadStatuses, refreshAvailability]);

  useEffect(() => {
    for (const status of statuses) {
      if (status.kind !== "link" && !versionsByBuild[status.id]) {
        loadVersions(status.id, 1);
      }
    }
  }, [statuses, versionsByBuild, loadVersions]);

  useEffect(() => {
    const unlisten = window.electron.onCustomProtonBuildInstallProgress(
      (payload) => {
        setProgress((prev) => ({ ...prev, [payload.buildId]: payload }));

        if (payload.phase === "done" || payload.phase === "error") {
          loadStatuses();
        }

        if (payload.phase === "done") {
          onProtonVersionsChanged?.();
        }
      }
    );

    return () => unlisten();
  }, [loadStatuses, onProtonVersionsChanged]);

  useEffect(() => {
    const unlisten = window.electron.onCustomProtonBuildUpdated(() => {
      loadStatuses();
      onProtonVersionsChanged?.();
    });

    return () => unlisten();
  }, [loadStatuses, onProtonVersionsChanged]);

  const handleInstall = async (
    buildId: CustomProtonBuildId,
    version?: string
  ) => {
    try {
      await window.electron.installCustomProtonBuild(buildId, version);
    } catch (err) {
      logger.error(err);
    } finally {
      loadStatuses();
    }
  };

  const handleUninstall = async (
    buildId: CustomProtonBuildId,
    version: string
  ) => {
    try {
      await window.electron.uninstallCustomProtonBuild(buildId, version);
    } catch (err) {
      logger.error(err);
    } finally {
      loadStatuses();
      onProtonVersionsChanged?.();
    }
  };

  const handleAutoUpdateToggle = async (
    buildId: CustomProtonBuildId,
    enabled: boolean
  ) => {
    setStatuses((prev) =>
      prev.map((status) =>
        status.id === buildId ? { ...status, autoUpdate: enabled } : status
      )
    );
    await window.electron.setCustomProtonBuildAutoUpdate(buildId, enabled);
  };

  const handleVersionSelect = (
    status: CustomProtonBuildStatus,
    value: string
  ) => {
    if (value === LOAD_MORE_VERSIONS_VALUE) {
      const nextPage = versionsByBuild[status.id]?.nextPage;
      if (nextPage) loadVersions(status.id, nextPage);
      return;
    }

    setSelectedVersionByBuild((prev) => ({ ...prev, [status.id]: value }));
  };

  const buildIcon = (status: CustomProtonBuildStatus) => {
    const current = progress[status.id];
    const busy =
      current?.phase === "downloading" || current?.phase === "extracting";

    if (busy)
      return (
        <SyncIcon size={16} className="custom-proton-builds-section__spin" />
      );
    if (current?.phase === "error") return <AlertIcon size={16} />;
    if (status.installs.length > 0) return <CheckCircleFillIcon size={18} />;
    return <DownloadIcon size={16} />;
  };

  const installVersionLabel = (
    install: CustomProtonBuildStatus["installs"][number]
  ) =>
    install.trackingLatest
      ? t("custom_proton_build_version_latest_tag", {
          version: install.version,
        })
      : install.version;

  const installLabel = (
    status: CustomProtonBuildStatus,
    install: CustomProtonBuildStatus["installs"][number]
  ) => {
    if (install.updateAvailable) {
      return t("custom_proton_build_installed_update_available", {
        version: installVersionLabel(install),
        latestVersion: status.latestVersion,
      });
    }
    return t("custom_proton_build_installed_version", {
      version: installVersionLabel(install),
    });
  };

  return (
    <div className="custom-proton-builds-section">
      <h3 className="custom-proton-builds-section__title">
        {t("custom_proton_builds")}
      </h3>
      <p className="custom-proton-builds-section__description">
        {t("custom_proton_builds_description")}
      </p>

      <div className="custom-proton-builds-section__list">
        {statuses.map((status) => {
          const current = progress[status.id];
          const busy =
            current?.phase === "downloading" || current?.phase === "extracting";
          const selectedVersion =
            selectedVersionByBuild[status.id] ?? LATEST_VERSION_VALUE;
          const versionState = versionsByBuild[status.id];
          const alreadyInstalled = status.installs.some((install) =>
            selectedVersion === LATEST_VERSION_VALUE
              ? install.trackingLatest
              : install.version === selectedVersion
          );

          const versionOptions = [
            {
              key: LATEST_VERSION_VALUE,
              value: LATEST_VERSION_VALUE,
              label: t("custom_proton_build_latest_option"),
            },
            ...(versionState?.options.map((option) => ({
              key: option.version,
              value: option.version,
              label: option.version,
            })) ?? []),
            ...(versionState?.nextPage
              ? [
                  {
                    key: LOAD_MORE_VERSIONS_VALUE,
                    value: LOAD_MORE_VERSIONS_VALUE,
                    label: t("custom_proton_build_load_more_versions"),
                  },
                ]
              : []),
          ];

          return (
            <div key={status.id} className="custom-proton-builds-section__row">
              <div className="custom-proton-builds-section__row-heading">
                <span className="custom-proton-builds-section__row-icon">
                  {buildIcon(status)}
                </span>
                <span className="custom-proton-builds-section__row-title">
                  {status.name}
                </span>
                <Link
                  to={status.htmlUrl ?? `https://github.com/${status.repo}`}
                  className="custom-proton-builds-section__row-link"
                >
                  {status.repo}
                  <LinkExternalIcon size={12} />
                </Link>
              </div>

              {status.kind === "link" ? (
                <span className="custom-proton-builds-section__row-status">
                  {t("custom_proton_build_no_prebuilt_releases")}
                </span>
              ) : (
                <>
                  {current?.phase === "downloading" ? (
                    <span className="custom-proton-builds-section__row-status">
                      {t("custom_proton_build_installing")}
                    </span>
                  ) : current?.phase === "extracting" ? (
                    <span className="custom-proton-builds-section__row-status">
                      {t("custom_proton_build_extracting")}
                    </span>
                  ) : current?.phase === "error" ? (
                    <span className="custom-proton-builds-section__row-status">
                      {t("custom_proton_build_install_failed")}
                    </span>
                  ) : status.installs.length === 0 ? (
                    <span className="custom-proton-builds-section__row-status">
                      {t("custom_proton_build_not_installed")}
                    </span>
                  ) : (
                    <ul className="custom-proton-builds-section__installs">
                      {status.installs.map((install) => (
                        <li
                          key={install.version}
                          className="custom-proton-builds-section__install"
                        >
                          <span className="custom-proton-builds-section__row-status">
                            {installLabel(status, install)}
                          </span>

                          {install.trackingLatest && (
                            <CheckboxField
                              label={t("custom_proton_build_auto_update")}
                              checked={status.autoUpdate}
                              onChange={(event) =>
                                handleAutoUpdateToggle(
                                  status.id,
                                  event.target.checked
                                )
                              }
                            />
                          )}

                          <Button
                            theme="danger"
                            className="custom-proton-builds-section__install-remove"
                            onClick={() =>
                              handleUninstall(status.id, install.version)
                            }
                            disabled={busy}
                            aria-label={t("custom_proton_build_uninstall")}
                          >
                            <TrashIcon size={14} />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="custom-proton-builds-section__row-actions">
                    <SelectField
                      className="custom-proton-builds-section__version-select"
                      value={selectedVersion}
                      options={versionOptions}
                      disabled={busy}
                      onChange={(event) =>
                        handleVersionSelect(status, event.target.value)
                      }
                    />

                    <Button
                      theme="primary"
                      onClick={() =>
                        handleInstall(
                          status.id,
                          selectedVersion === LATEST_VERSION_VALUE
                            ? undefined
                            : selectedVersion
                        )
                      }
                      disabled={busy || alreadyInstalled}
                    >
                      <DownloadIcon size={14} />
                      <span>{t("custom_proton_build_install")}</span>
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
