import "./compatibility.scss";

import type {
  CustomProtonBuildId,
  CustomProtonBuildStatus,
  CustomProtonBuildVersionOption,
  ProtonVersion,
  UserPreferences,
} from "@types";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { GAMEMODE_SITE_URL, MANGOHUD_SITE_URL } from "@shared";
import { TrashIcon } from "@phosphor-icons/react";

import {
  Button,
  Checkbox,
  DropdownSelect,
  Radio,
  VerticalFocusGroup,
} from "../../components";
import type { DropdownSelectOption } from "../../components";
import { useUserPreferences, useBigPictureToast } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  COMPATIBILITY_COMMON_REDIST_BUTTON_ID,
  COMPATIBILITY_CUSTOM_PROTON_BUILDS_REGION_ID,
  COMPATIBILITY_GAMEMODE_FOCUS_ID,
  COMPATIBILITY_MANGOHUD_FOCUS_ID,
  COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
  COMPATIBILITY_SECTION_REGION_ID,
  getCompatibilityProtonOptionFocusId,
  getCustomProtonBuildAutoUpdateFocusId,
  getCustomProtonBuildInstallFocusId,
  getCustomProtonBuildUninstallFocusId,
  getCustomProtonBuildVersionSelectFocusId,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

const LATEST_VERSION_VALUE = "latest";
const LOAD_MORE_VERSIONS_VALUE = "__load_more__";

interface CustomProtonBuildVersionState {
  options: CustomProtonBuildVersionOption[];
  nextPage: number | null;
}

interface SettingsSectionProps {
  className?: string;
}

interface CompatibilityForm {
  defaultProtonPath: string;
  autoRunGamemode: boolean;
  autoRunMangohud: boolean;
}

interface CompatibilityPreferenceValues {
  defaultProtonPath?: string | null;
  autoRunGamemode?: boolean;
  autoRunMangohud?: boolean;
}

interface CompatibilityItem {
  focusId: string;
  render: (navigationOverrides: FocusOverrides) => React.JSX.Element;
  disabled?: boolean;
}

interface ProtonOption {
  focusId: string;
  value: string;
  title: string;
  description: string;
  disabled: boolean;
}

const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

const DEFAULT_FORM: CompatibilityForm = {
  defaultProtonPath: "",
  autoRunGamemode: false,
  autoRunMangohud: false,
};

const buildForm = (preferences: UserPreferences | null): CompatibilityForm =>
  preferences
    ? {
        defaultProtonPath: preferences.defaultProtonPath ?? "",
        autoRunGamemode: preferences.autoRunGamemode ?? false,
        autoRunMangohud: preferences.autoRunMangohud ?? false,
      }
    : DEFAULT_FORM;

function getProtonSourceDescription(version: ProtonVersion | null) {
  if (!version) {
    return "Uses the default UMU-managed Proton version.";
  }

  if (
    version.source === "compatibility_tools" ||
    version.path.includes("compatibilitytools.d")
  ) {
    return "Installed in Steam compatibilitytools.d.";
  }

  return "Installed in Steam.";
}

export function CompatibilitySettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const userPreferences = useUserPreferences();
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [form, setForm] = useState<CompatibilityForm>(() =>
    buildForm(userPreferences)
  );
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [protonVersionsLoaded, setProtonVersionsLoaded] = useState(false);
  const [gamemodeAvailable, setGamemodeAvailable] = useState(false);
  const [mangohudAvailable, setMangohudAvailable] = useState(false);
  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);
  const [customProtonBuilds, setCustomProtonBuilds] = useState<
    CustomProtonBuildStatus[]
  >([]);
  const [customProtonBuildsBusy, setCustomProtonBuildsBusy] = useState<
    Partial<Record<CustomProtonBuildId, boolean>>
  >({});
  const [customProtonBuildErrors, setCustomProtonBuildErrors] = useState<
    Partial<Record<CustomProtonBuildId, boolean>>
  >({});
  const [customProtonBuildVersions, setCustomProtonBuildVersions] = useState<
    Partial<Record<CustomProtonBuildId, CustomProtonBuildVersionState>>
  >({});
  const [
    selectedCustomProtonBuildVersion,
    setSelectedCustomProtonBuildVersion,
  ] = useState<Partial<Record<CustomProtonBuildId, string>>>({});

  const isDev = import.meta.env.DEV;
  const isLinux = globalThis.window.electron.platform === "linux";
  const isWindows = globalThis.window.electron.platform === "win32";
  const shouldRenderProtonSection = isLinux || isDev;
  const shouldRenderCustomProtonBuildsSection = isLinux || isDev;
  const shouldRenderBehaviorSection = isLinux || isDev;
  const shouldRenderCommonRedistSection = isWindows || isDev;
  const canUseProtonSection = isLinux;
  const canUseCustomProtonBuildsSection = isLinux;
  const canUseBehaviorSection = isLinux;
  const canUseCommonRedistSection = isWindows;

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  useEffect(() => {
    if (!isLinux) {
      setGamemodeAvailable(false);
      setMangohudAvailable(false);
      return;
    }

    globalThis.window.electron
      .isGamemodeAvailable()
      .then(setGamemodeAvailable)
      .catch(() => setGamemodeAvailable(false));

    globalThis.window.electron
      .isMangohudAvailable()
      .then(setMangohudAvailable)
      .catch(() => setMangohudAvailable(false));
  }, [isLinux]);

  useEffect(() => {
    if (!isLinux) return;

    globalThis.window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]))
      .finally(() => setProtonVersionsLoaded(true));
  }, [isLinux]);

  useEffect(() => {
    if (!isLinux) return;

    if (!protonVersionsLoaded || !form.defaultProtonPath) return;

    const hasSelectedVersion = protonVersions.some(
      (version) => version.path === form.defaultProtonPath
    );

    if (!hasSelectedVersion) {
      setForm((currentForm) => ({
        ...currentForm,
        defaultProtonPath: "",
      }));
    }
  }, [form.defaultProtonPath, isLinux, protonVersions, protonVersionsLoaded]);

  const refreshProtonVersions = useCallback(() => {
    if (!isLinux) return;

    globalThis.window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]));
  }, [isLinux]);

  const refreshCustomProtonBuilds = useCallback(() => {
    if (!isLinux) return;

    const seedSelectedVersions = (results: CustomProtonBuildStatus[]) => {
      setCustomProtonBuilds(results);
      setSelectedCustomProtonBuildVersion((previous) => {
        const next = { ...previous };
        for (const status of results) {
          if (!(status.id in next)) {
            next[status.id] = LATEST_VERSION_VALUE;
          }
        }
        return next;
      });
    };

    globalThis.window.electron
      .getCustomProtonBuilds()
      .then(seedSelectedVersions)
      .catch(() => {});

    globalThis.window.electron
      .refreshCustomProtonBuilds()
      .then(seedSelectedVersions)
      .catch(() => {});
  }, [isLinux]);

  useEffect(() => {
    refreshCustomProtonBuilds();
  }, [refreshCustomProtonBuilds]);

  const loadCustomProtonBuildVersions = useCallback(
    (buildId: CustomProtonBuildId, page: number) => {
      globalThis.window.electron
        .getCustomProtonBuildVersions(buildId, page)
        .then((result) => {
          setCustomProtonBuildVersions((previous) => ({
            ...previous,
            [buildId]: {
              options: [
                ...(page === 1 ? [] : (previous[buildId]?.options ?? [])),
                ...result.versions,
              ],
              nextPage: result.nextPage,
            },
          }));
        })
        .catch(() => {});
    },
    []
  );

  useEffect(() => {
    if (!isLinux) return;

    for (const status of customProtonBuilds) {
      if (status.kind !== "link" && !customProtonBuildVersions[status.id]) {
        loadCustomProtonBuildVersions(status.id, 1);
      }
    }
  }, [
    customProtonBuilds,
    customProtonBuildVersions,
    isLinux,
    loadCustomProtonBuildVersions,
  ]);

  useEffect(() => {
    if (!isLinux) return;

    return globalThis.window.electron.onCustomProtonBuildInstallProgress(
      (payload) => {
        setCustomProtonBuildsBusy((previous) => ({
          ...previous,
          [payload.buildId]:
            payload.phase === "downloading" || payload.phase === "extracting",
        }));
        setCustomProtonBuildErrors((previous) => ({
          ...previous,
          [payload.buildId]: payload.phase === "error",
        }));

        if (payload.phase === "done" || payload.phase === "error") {
          refreshCustomProtonBuilds();
        }

        if (payload.phase === "done") {
          refreshProtonVersions();
        }
      }
    );
  }, [isLinux, refreshCustomProtonBuilds, refreshProtonVersions]);

  useEffect(() => {
    if (!isLinux) return;

    return globalThis.window.electron.onCustomProtonBuildUpdated(() => {
      refreshCustomProtonBuilds();
      refreshProtonVersions();
    });
  }, [isLinux, refreshCustomProtonBuilds, refreshProtonVersions]);

  const handleCustomProtonBuildInstall = useCallback(
    async (buildId: CustomProtonBuildId, version?: string) => {
      try {
        const result =
          await globalThis.window.electron.installCustomProtonBuild(
            buildId,
            version
          );
        if (result.ok) {
          showSuccessToast("Proton build installed", SETTINGS_TOAST_OPTIONS);
        } else {
          showErrorToast(
            "Failed to install Proton build",
            SETTINGS_TOAST_OPTIONS
          );
        }
      } catch {
        showErrorToast(
          "Failed to install Proton build",
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        refreshCustomProtonBuilds();
      }
    },
    [refreshCustomProtonBuilds, showErrorToast, showSuccessToast]
  );

  const handleCustomProtonBuildUninstall = useCallback(
    async (buildId: CustomProtonBuildId, version: string) => {
      try {
        const result =
          await globalThis.window.electron.uninstallCustomProtonBuild(
            buildId,
            version
          );
        if (result.ok) {
          showSuccessToast("Proton build removed", SETTINGS_TOAST_OPTIONS);
        } else {
          showErrorToast(
            "Failed to remove Proton build",
            SETTINGS_TOAST_OPTIONS
          );
        }
      } catch {
        showErrorToast("Failed to remove Proton build", SETTINGS_TOAST_OPTIONS);
      } finally {
        refreshCustomProtonBuilds();
        refreshProtonVersions();
      }
    },
    [
      refreshCustomProtonBuilds,
      refreshProtonVersions,
      showErrorToast,
      showSuccessToast,
    ]
  );

  const handleCustomProtonBuildVersionSelect = useCallback(
    (buildId: CustomProtonBuildId, value: string) => {
      if (value === LOAD_MORE_VERSIONS_VALUE) {
        const nextPage = customProtonBuildVersions[buildId]?.nextPage;
        if (nextPage) loadCustomProtonBuildVersions(buildId, nextPage);
        return;
      }

      setSelectedCustomProtonBuildVersion((previous) => ({
        ...previous,
        [buildId]: value,
      }));
    },
    [customProtonBuildVersions, loadCustomProtonBuildVersions]
  );

  const handleCustomProtonBuildAutoUpdateToggle = useCallback(
    async (buildId: CustomProtonBuildId, enabled: boolean) => {
      setCustomProtonBuilds((previous) =>
        previous.map((status) =>
          status.id === buildId ? { ...status, autoUpdate: enabled } : status
        )
      );
      await globalThis.window.electron.setCustomProtonBuildAutoUpdate(
        buildId,
        enabled
      );
    },
    []
  );

  useEffect(() => {
    if (!isWindows) return;

    globalThis.window.electron.canInstallCommonRedist().then((canInstall) => {
      setCanInstallCommonRedist(canInstall);
    });

    const intervalId = globalThis.window.setInterval(() => {
      globalThis.window.electron
        .canInstallCommonRedist()
        .then((canInstall) => {
          setCanInstallCommonRedist(canInstall);
        })
        .catch(() => {
          setCanInstallCommonRedist(false);
        });
    }, 1000 * 5);

    return () => {
      globalThis.window.clearInterval(intervalId);
    };
  }, [isWindows]);

  useEffect(() => {
    if (!isWindows) return;

    return globalThis.window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setInstallingCommonRedist(false);

          if (complete) {
            showSuccessToast("Installation Complete", {
              message:
                "Common redistributables have been installed successfully.",
            });
          }
        }
      }
    );
  }, [isWindows, showSuccessToast]);

  const updateCompatibilityPreferences = useCallback(
    async (values: CompatibilityPreferenceValues) => {
      setForm((currentForm) => ({
        ...currentForm,
        ...values,
        defaultProtonPath:
          values.defaultProtonPath === undefined
            ? currentForm.defaultProtonPath
            : (values.defaultProtonPath ?? ""),
      }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleInstallCommonRedist = useCallback(async () => {
    setInstallingCommonRedist(true);

    try {
      await globalThis.window.electron.installCommonRedist();
    } catch {
      setInstallingCommonRedist(false);
    }
  }, []);

  const handleOpenExternalLink = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>, url: string) => {
      event.preventDefault();
      event.stopPropagation();
      await globalThis.window.electron.openExternal(url);
    },
    []
  );

  const protonOptions = useMemo<ProtonOption[]>(() => {
    const options: ProtonOption[] = [
      {
        focusId: COMPATIBILITY_PROTON_OPTION_AUTO_FOCUS_ID,
        value: "",
        title: "Auto",
        description: getProtonSourceDescription(null),
        disabled: !canUseProtonSection,
      },
    ];

    for (const version of protonVersions) {
      options.push({
        focusId: getCompatibilityProtonOptionFocusId(version.path),
        value: version.path,
        title: version.name,
        description: getProtonSourceDescription(version),
        disabled: !canUseProtonSection,
      });
    }

    return options;
  }, [canUseProtonSection, protonVersions]);

  const items = useMemo<CompatibilityItem[]>(() => {
    const nextItems: CompatibilityItem[] = [];

    if (shouldRenderProtonSection) {
      nextItems.push(
        ...protonOptions.map((option) => ({
          focusId: option.focusId,
          disabled: option.disabled,
          render: (navigationOverrides: FocusOverrides) => (
            <Radio
              key={option.focusId}
              id={option.focusId}
              label={
                <span className="compatibility-settings-section__proton-option-label">
                  <span className="compatibility-settings-section__proton-option-title">
                    {option.title}
                  </span>
                  <span className="compatibility-settings-section__proton-option-description">
                    {option.description}
                  </span>
                </span>
              }
              checked={form.defaultProtonPath === option.value}
              disabled={option.disabled}
              focusId={option.focusId}
              navigationOverrides={navigationOverrides}
              block
              onChange={() => {
                void updateCompatibilityPreferences({
                  defaultProtonPath: option.value || null,
                });
              }}
            />
          ),
        }))
      );
    }

    if (shouldRenderCustomProtonBuildsSection) {
      for (const status of customProtonBuilds) {
        if (status.kind === "link") continue;

        const versionSelectFocusId = getCustomProtonBuildVersionSelectFocusId(
          status.id
        );
        const autoUpdateFocusId = getCustomProtonBuildAutoUpdateFocusId(
          status.id
        );
        const installFocusId = getCustomProtonBuildInstallFocusId(status.id);
        const busy = customProtonBuildsBusy[status.id] ?? false;
        const selectedVersion =
          selectedCustomProtonBuildVersion[status.id] ?? LATEST_VERSION_VALUE;
        const versionState = customProtonBuildVersions[status.id];
        const alreadyInstalled = status.installs.some((install) =>
          selectedVersion === LATEST_VERSION_VALUE
            ? install.trackingLatest
            : install.version === selectedVersion
        );

        const versionOptions: DropdownSelectOption[] = [
          { value: LATEST_VERSION_VALUE, label: "Latest" },
          ...(versionState?.options.map((option) => ({
            value: option.version,
            label: option.version,
          })) ?? []),
          ...(versionState?.nextPage
            ? [{ value: LOAD_MORE_VERSIONS_VALUE, label: "Load more…" }]
            : []),
        ];

        nextItems.push({
          focusId: versionSelectFocusId,
          disabled: !canUseCustomProtonBuildsSection || busy,
          render: (navigationOverrides: FocusOverrides) => (
            <DropdownSelect
              key={versionSelectFocusId}
              label="Version"
              hideLabel
              value={selectedVersion}
              options={versionOptions}
              disabled={!canUseCustomProtonBuildsSection || busy}
              focusId={versionSelectFocusId}
              focusNavigationOverrides={navigationOverrides}
              onValueChange={(value) => {
                handleCustomProtonBuildVersionSelect(status.id, value);
              }}
            />
          ),
        });

        nextItems.push({
          focusId: installFocusId,
          disabled:
            !canUseCustomProtonBuildsSection || busy || alreadyInstalled,
          render: (navigationOverrides: FocusOverrides) => (
            <Button
              key={installFocusId}
              variant="secondary"
              size="small"
              loading={busy}
              disabled={!canUseCustomProtonBuildsSection || alreadyInstalled}
              focusId={installFocusId}
              focusNavigationOverrides={navigationOverrides}
              onClick={() => {
                void handleCustomProtonBuildInstall(
                  status.id,
                  selectedVersion === LATEST_VERSION_VALUE
                    ? undefined
                    : selectedVersion
                );
              }}
            >
              Install
            </Button>
          ),
        });

        for (const install of status.installs) {
          const uninstallFocusId = getCustomProtonBuildUninstallFocusId(
            status.id,
            install.version
          );

          if (install.trackingLatest) {
            nextItems.push({
              focusId: autoUpdateFocusId,
              disabled: !canUseCustomProtonBuildsSection,
              render: (navigationOverrides: FocusOverrides) => (
                <Checkbox
                  key={autoUpdateFocusId}
                  id={autoUpdateFocusId}
                  label="Auto-update"
                  checked={status.autoUpdate}
                  disabled={!canUseCustomProtonBuildsSection}
                  focusId={autoUpdateFocusId}
                  navigationOverrides={navigationOverrides}
                  onChange={(checked) => {
                    void handleCustomProtonBuildAutoUpdateToggle(
                      status.id,
                      checked
                    );
                  }}
                />
              ),
            });
          }

          nextItems.push({
            focusId: uninstallFocusId,
            disabled: !canUseCustomProtonBuildsSection || busy,
            render: (navigationOverrides: FocusOverrides) => (
              <Button
                key={uninstallFocusId}
                variant="secondary"
                size="icon"
                aria-label={`Uninstall ${install.version}`}
                disabled={!canUseCustomProtonBuildsSection || busy}
                focusId={uninstallFocusId}
                focusNavigationOverrides={navigationOverrides}
                onClick={() => {
                  void handleCustomProtonBuildUninstall(
                    status.id,
                    install.version
                  );
                }}
              >
                <TrashIcon size={16} />
              </Button>
            ),
          });
        }
      }
    }

    if (shouldRenderBehaviorSection) {
      nextItems.push(
        {
          focusId: COMPATIBILITY_GAMEMODE_FOCUS_ID,
          disabled: !canUseBehaviorSection || !gamemodeAvailable,
          render: (navigationOverrides: FocusOverrides) => (
            <div
              key={COMPATIBILITY_GAMEMODE_FOCUS_ID}
              className="compatibility-settings-section__behavior-item"
            >
              <Checkbox
                id={COMPATIBILITY_GAMEMODE_FOCUS_ID}
                label="Run with GameMode"
                secondaryText={
                  <>
                    Improves performance on supported Linux systems.{" "}
                    <a
                      className="compatibility-settings-section__helper-link"
                      href={GAMEMODE_SITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        void handleOpenExternalLink(event, GAMEMODE_SITE_URL);
                      }}
                    >
                      Learn more
                    </a>
                    .
                  </>
                }
                checked={form.autoRunGamemode}
                disabled={!canUseBehaviorSection || !gamemodeAvailable}
                focusId={COMPATIBILITY_GAMEMODE_FOCUS_ID}
                navigationOverrides={navigationOverrides}
                block
                onChange={(checked) => {
                  void updateCompatibilityPreferences({
                    autoRunGamemode: checked,
                  });
                }}
              />
              {canUseBehaviorSection && !gamemodeAvailable ? (
                <p className="compatibility-settings-section__helper-note">
                  GameMode is not available in your PATH.
                </p>
              ) : null}
            </div>
          ),
        },
        {
          focusId: COMPATIBILITY_MANGOHUD_FOCUS_ID,
          disabled: !canUseBehaviorSection || !mangohudAvailable,
          render: (navigationOverrides: FocusOverrides) => (
            <div
              key={COMPATIBILITY_MANGOHUD_FOCUS_ID}
              className="compatibility-settings-section__behavior-item"
            >
              <Checkbox
                id={COMPATIBILITY_MANGOHUD_FOCUS_ID}
                label="Run with MangoHud"
                secondaryText={
                  <>
                    Shows performance metrics while you play.{" "}
                    <a
                      className="compatibility-settings-section__helper-link"
                      href={MANGOHUD_SITE_URL}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        void handleOpenExternalLink(event, MANGOHUD_SITE_URL);
                      }}
                    >
                      Learn more
                    </a>
                    .
                  </>
                }
                checked={form.autoRunMangohud}
                disabled={!canUseBehaviorSection || !mangohudAvailable}
                focusId={COMPATIBILITY_MANGOHUD_FOCUS_ID}
                navigationOverrides={navigationOverrides}
                block
                onChange={(checked) => {
                  void updateCompatibilityPreferences({
                    autoRunMangohud: checked,
                  });
                }}
              />
              {canUseBehaviorSection && !mangohudAvailable ? (
                <p className="compatibility-settings-section__helper-note">
                  MangoHud is not available in your PATH.
                </p>
              ) : null}
            </div>
          ),
        }
      );
    }

    if (shouldRenderCommonRedistSection) {
      nextItems.push({
        focusId: COMPATIBILITY_COMMON_REDIST_BUTTON_ID,
        disabled: !canUseCommonRedistSection || !canInstallCommonRedist,
        render: (navigationOverrides: FocusOverrides) => (
          <Button
            key={COMPATIBILITY_COMMON_REDIST_BUTTON_ID}
            className="compatibility-settings-section__common-redist-button"
            disabled={!canUseCommonRedistSection || !canInstallCommonRedist}
            loading={installingCommonRedist}
            focusId={COMPATIBILITY_COMMON_REDIST_BUTTON_ID}
            focusNavigationOverrides={navigationOverrides}
            onClick={() => {
              void handleInstallCommonRedist();
            }}
          >
            {installingCommonRedist
              ? "Installing Common Redist..."
              : "Install Common Redist"}
          </Button>
        ),
      });
    }

    return nextItems;
  }, [
    canInstallCommonRedist,
    canUseBehaviorSection,
    canUseCommonRedistSection,
    canUseCustomProtonBuildsSection,
    customProtonBuilds,
    customProtonBuildsBusy,
    customProtonBuildVersions,
    selectedCustomProtonBuildVersion,
    form.autoRunGamemode,
    form.autoRunMangohud,
    form.defaultProtonPath,
    gamemodeAvailable,
    handleCustomProtonBuildAutoUpdateToggle,
    handleCustomProtonBuildInstall,
    handleCustomProtonBuildUninstall,
    handleCustomProtonBuildVersionSelect,
    handleInstallCommonRedist,
    installingCommonRedist,
    mangohudAvailable,
    protonOptions,
    shouldRenderCommonRedistSection,
    shouldRenderBehaviorSection,
    shouldRenderCustomProtonBuildsSection,
    shouldRenderProtonSection,
    updateCompatibilityPreferences,
  ]);

  const activeItems = useMemo(
    () => items.filter((item) => !item.disabled),
    [items]
  );

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      activeItems.map((item, index) => {
        const previousItem = activeItems[index - 1];
        const nextItem = activeItems[index + 1];

        return [
          item.focusId,
          {
            up: previousItem
              ? {
                  type: "item",
                  itemId: previousItem.focusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextItem
              ? {
                  type: "item",
                  itemId: nextItem.focusId,
                }
              : { type: "block" },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [activeItems]);

  return (
    <div
      className={
        className
          ? `compatibility-settings-section ${className}`
          : "compatibility-settings-section"
      }
    >
      {shouldRenderProtonSection ? (
        <SettingsSection
          title="Default Proton Version"
          description="Choose which Proton version Hydra should use by default for compatible games."
        >
          <VerticalFocusGroup
            regionId={COMPATIBILITY_SECTION_REGION_ID}
            asChild
          >
            <div className="compatibility-settings-section__proton-options">
              {protonOptions.map((option) =>
                items
                  .find((item) => item.focusId === option.focusId)
                  ?.render(navigationOverridesByFocusId[option.focusId] ?? {})
              )}
            </div>
          </VerticalFocusGroup>
        </SettingsSection>
      ) : null}

      {shouldRenderCustomProtonBuildsSection ? (
        <SettingsSection
          title="Custom Proton Builds"
          description="Install and auto-update community Proton builds from GitHub."
        >
          <VerticalFocusGroup
            regionId={COMPATIBILITY_CUSTOM_PROTON_BUILDS_REGION_ID}
            asChild
          >
            <div className="compatibility-settings-section__content">
              {customProtonBuilds
                .filter((status) => status.kind !== "link")
                .map((status) => {
                  const versionSelectFocusId =
                    getCustomProtonBuildVersionSelectFocusId(status.id);
                  const autoUpdateFocusId =
                    getCustomProtonBuildAutoUpdateFocusId(status.id);
                  const installFocusId = getCustomProtonBuildInstallFocusId(
                    status.id
                  );

                  return (
                    <div
                      key={status.id}
                      className="compatibility-settings-section__custom-proton-build-row"
                    >
                      <div className="compatibility-settings-section__proton-option-label">
                        <span className="compatibility-settings-section__proton-option-title">
                          {status.name}
                        </span>
                        {customProtonBuildErrors[status.id] ? (
                          <span className="compatibility-settings-section__proton-option-description">
                            Install failed. Please try again.
                          </span>
                        ) : status.installs.length === 0 ? (
                          <span className="compatibility-settings-section__proton-option-description">
                            Not installed
                          </span>
                        ) : (
                          status.installs.map((install) => (
                            <div
                              key={install.version}
                              className="compatibility-settings-section__install-row"
                            >
                              <span className="compatibility-settings-section__proton-option-description">
                                {install.updateAvailable
                                  ? `Installed: ${install.version} (latest) — update available: ${status.latestVersion}`
                                  : install.trackingLatest
                                    ? `Installed: ${install.version} (latest)`
                                    : `Installed: ${install.version}`}
                              </span>
                              {install.trackingLatest &&
                                items
                                  .find(
                                    (item) => item.focusId === autoUpdateFocusId
                                  )
                                  ?.render(
                                    navigationOverridesByFocusId[
                                      autoUpdateFocusId
                                    ] ?? {}
                                  )}
                              {items
                                .find(
                                  (item) =>
                                    item.focusId ===
                                    getCustomProtonBuildUninstallFocusId(
                                      status.id,
                                      install.version
                                    )
                                )
                                ?.render(
                                  navigationOverridesByFocusId[
                                    getCustomProtonBuildUninstallFocusId(
                                      status.id,
                                      install.version
                                    )
                                  ] ?? {}
                                )}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="compatibility-settings-section__custom-proton-build-actions">
                        {items
                          .find((item) => item.focusId === versionSelectFocusId)
                          ?.render(
                            navigationOverridesByFocusId[
                              versionSelectFocusId
                            ] ?? {}
                          )}
                        {items
                          .find((item) => item.focusId === installFocusId)
                          ?.render(
                            navigationOverridesByFocusId[installFocusId] ?? {}
                          )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </VerticalFocusGroup>
        </SettingsSection>
      ) : null}

      {shouldRenderBehaviorSection ? (
        <SettingsSection
          title="Behavior"
          description="Control which compatibility helpers Hydra should use when launching supported games."
        >
          <div className="compatibility-settings-section__content">
            {items
              .filter(
                (item) =>
                  item.focusId === COMPATIBILITY_GAMEMODE_FOCUS_ID ||
                  item.focusId === COMPATIBILITY_MANGOHUD_FOCUS_ID
              )
              .map((item) =>
                item.render(navigationOverridesByFocusId[item.focusId] ?? {})
              )}
          </div>
        </SettingsSection>
      ) : null}

      {shouldRenderCommonRedistSection ? (
        <SettingsSection
          title="Common Redist"
          description="Install the Microsoft redistributables required by some Windows games."
        >
          <div className="compatibility-settings-section__content">
            {items
              .filter(
                (item) => item.focusId === COMPATIBILITY_COMMON_REDIST_BUTTON_ID
              )
              .map((item) =>
                item.render(navigationOverridesByFocusId[item.focusId] ?? {})
              )}
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}
