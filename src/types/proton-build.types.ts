export type CustomProtonBuildId =
  | "ge-proton"
  | "proton-cachyos"
  | "proton-em"
  | "dw-proton"
  | "proton-rtsp"
  | "proton-wineland"
  | "proton-tkg";

export type CustomProtonBuildKind =
  | "github-release"
  | "github-actions"
  | "link";

export interface ResolvedCustomProtonBuildOption {
  id: CustomProtonBuildId;
  name: string;
  repo: string;
  kind: CustomProtonBuildKind;
  downloadUrl: string | null;
  fileName: string | null;
  version: string | null;
  htmlUrl: string | null;
  linkUrl: string | null;
}

export type CustomProtonBuildInstallPhase =
  | "downloading"
  | "extracting"
  | "done"
  | "error";

export interface CustomProtonBuildInstallProgress {
  buildId: CustomProtonBuildId;
  phase: CustomProtonBuildInstallPhase;
  loaded?: number;
  total?: number;
  reason?: string;
  version?: string;
}

export interface CustomProtonBuildInstallResult {
  ok: boolean;
  path?: string;
  version?: string;
  reason?: string;
}

export interface CustomProtonBuildInstall {
  version: string;
  path: string;
  trackingLatest: boolean;
}

export interface CustomProtonBuildRecord {
  installs: CustomProtonBuildInstall[];
  autoUpdate: boolean;
  lastCheckedAt: string | null;
}

export interface CustomProtonBuildInstallStatus {
  version: string;
  path: string;
  trackingLatest: boolean;
  updateAvailable: boolean;
}

export interface CustomProtonBuildStatus {
  id: CustomProtonBuildId;
  name: string;
  repo: string;
  kind: CustomProtonBuildKind;
  htmlUrl: string | null;
  installs: CustomProtonBuildInstallStatus[];
  autoUpdate: boolean;
  latestVersion: string | null;
  lastCheckedAt: string | null;
}

export interface CustomProtonBuildVersionOption {
  version: string;
  htmlUrl: string | null;
}

export interface CustomProtonBuildVersionsPage {
  versions: CustomProtonBuildVersionOption[];
  nextPage: number | null;
}
