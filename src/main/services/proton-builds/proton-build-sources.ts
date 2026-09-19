import axios from "axios";

import type {
  CustomProtonBuildId,
  CustomProtonBuildKind,
  CustomProtonBuildVersionsPage,
  ResolvedCustomProtonBuildOption,
} from "@types";

import { logger } from "../logger";

interface CustomProtonBuildGithubEntry {
  id: CustomProtonBuildId;
  name: string;
  kind: "github-release";
  repo: string;
  assetPattern: RegExp;
}

interface CustomProtonBuildActionsEntry {
  id: CustomProtonBuildId;
  name: string;
  kind: "github-actions";
  repo: string;
  workflowFile: string;
  artifactName: string;
}

interface CustomProtonBuildLinkEntry {
  id: CustomProtonBuildId;
  name: string;
  kind: "link";
  repo: string;
  linkUrl: string;
}

type CustomProtonBuildEntry =
  | CustomProtonBuildGithubEntry
  | CustomProtonBuildActionsEntry
  | CustomProtonBuildLinkEntry;

export const CUSTOM_PROTON_BUILD_CATALOG: CustomProtonBuildEntry[] = [
  {
    id: "ge-proton",
    name: "GE-Proton",
    kind: "github-release",
    repo: "GloriousEggroll/proton-ge-custom",
    assetPattern: /-x86_64\.tar\.gz$/i,
  },
  {
    id: "proton-cachyos",
    name: "Proton-CachyOS",
    kind: "github-release",
    repo: "CachyOS/proton-cachyos",
    assetPattern: /^proton-cachyos-.*-x86_64\.tar\.xz$/i,
  },
  {
    id: "proton-em",
    name: "Proton-EM",
    kind: "github-release",
    repo: "BananaWorks07/Proton",
    assetPattern: /^proton-EM-.*\.tar\.xz$/i,
  },
  {
    id: "dw-proton",
    name: "DW-Proton",
    kind: "github-release",
    repo: "dawn-winery/dwproton-mirror",
    assetPattern: /^dwproton-.*-x86_64\.tar\.xz$/i,
  },
  {
    id: "proton-rtsp",
    name: "Proton-RTSP",
    kind: "github-release",
    repo: "SpookySkeletons/proton-rtsp",
    assetPattern: /^proton-rtsp-.*\.tar\.gz$/i,
  },
  {
    id: "proton-wineland",
    name: "Proton-Wineland",
    kind: "github-release",
    repo: "nanomatters/proton-cachyos",
    assetPattern: /-x86_64\.tar\.xz$/i,
  },
  {
    id: "proton-tkg",
    name: "Proton-TKG",
    kind: "github-actions",
    repo: "Frogging-Family/wine-tkg-git",
    workflowFile: "proton-valvexbe-sniper.yml",
    artifactName: "proton-tkg-build",
  },
];

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GithubAsset[];
}

const GITHUB_API = "https://api.github.com";
const GITHUB_API_TIMEOUT_MS = 15_000;
const RELEASE_CACHE_TTL_MS = 10 * 60 * 1000;

const releaseCache = new Map<
  string,
  { expiresAt: number; release: GithubRelease | null }
>();

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "HydraLauncher",
};

const isNotFoundError = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 404;

const releaseByTagCache = new Map<string, GithubRelease | null>();

const genericListCache = new Map<
  string,
  { expiresAt: number; value: unknown }
>();

const withShortLivedCache = async <T>(
  cacheKey: string,
  fetcher: () => Promise<T>
): Promise<T> => {
  const cached = genericListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const value = await fetcher();
  genericListCache.set(cacheKey, {
    expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
    value,
  });
  return value;
};

const fetchLatestRelease = async (
  repo: string
): Promise<GithubRelease | null> => {
  const cached = releaseCache.get(repo);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.release;
  }

  const config = { headers: githubHeaders, timeout: GITHUB_API_TIMEOUT_MS };

  try {
    const { data } = await axios.get<GithubRelease>(
      `${GITHUB_API}/repos/${repo}/releases/latest`,
      config
    );
    releaseCache.set(repo, {
      expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
      release: data,
    });
    return data;
  } catch (error) {
    logger.warn(
      `Failed to fetch latest release for ${repo}, trying release list`,
      error
    );
  }

  try {
    const { data } = await axios.get<GithubRelease[]>(
      `${GITHUB_API}/repos/${repo}/releases?per_page=5`,
      config
    );
    const release = data.find((candidate) => !candidate.draft) ?? null;
    releaseCache.set(repo, {
      expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
      release,
    });
    return release;
  } catch (error) {
    logger.error(`Failed to fetch releases for ${repo}`, error);
    releaseCache.set(repo, {
      expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
      release: null,
    });
    return null;
  }
};

const buildOptionFromRelease = (
  entry: CustomProtonBuildGithubEntry,
  release: GithubRelease | null
): ResolvedCustomProtonBuildOption => {
  if (!release) {
    return {
      id: entry.id,
      name: entry.name,
      repo: entry.repo,
      kind: "link",
      downloadUrl: null,
      fileName: null,
      version: null,
      htmlUrl: null,
      linkUrl: `https://github.com/${entry.repo}/releases`,
    };
  }

  const asset = release.assets.find((candidate) =>
    entry.assetPattern.test(candidate.name)
  );

  if (!asset) {
    return {
      id: entry.id,
      name: entry.name,
      repo: entry.repo,
      kind: "link",
      downloadUrl: null,
      fileName: null,
      version: release.tag_name,
      htmlUrl: release.html_url,
      linkUrl: release.html_url,
    };
  }

  return {
    id: entry.id,
    name: entry.name,
    repo: entry.repo,
    kind: "github-release",
    downloadUrl: asset.browser_download_url,
    fileName: asset.name,
    version: release.tag_name,
    htmlUrl: release.html_url,
    linkUrl: null,
  };
};

const resolveGithubReleaseOption = async (
  entry: CustomProtonBuildGithubEntry
): Promise<ResolvedCustomProtonBuildOption> => {
  const release = await fetchLatestRelease(entry.repo);
  return buildOptionFromRelease(entry, release);
};

const fetchReleaseByTag = async (
  repo: string,
  version: string
): Promise<GithubRelease | null> => {
  const cacheKey = `${repo}@${version}`;
  if (releaseByTagCache.has(cacheKey)) {
    return releaseByTagCache.get(cacheKey) ?? null;
  }

  try {
    const { data } = await axios.get<GithubRelease>(
      `${GITHUB_API}/repos/${repo}/releases/tags/${encodeURIComponent(version)}`,
      { headers: githubHeaders, timeout: GITHUB_API_TIMEOUT_MS }
    );
    releaseByTagCache.set(cacheKey, data);
    return data;
  } catch (error) {
    logger.error(`Failed to fetch release ${version} for ${repo}`, error);
    if (isNotFoundError(error)) releaseByTagCache.set(cacheKey, null);
    return null;
  }
};

export const resolveCustomProtonBuildOptionForVersion = async (
  entry: CustomProtonBuildGithubEntry | CustomProtonBuildActionsEntry,
  version: string
): Promise<ResolvedCustomProtonBuildOption> => {
  if (entry.kind === "github-actions") {
    return resolveGithubActionsOptionForVersion(entry, version);
  }

  const release = await fetchReleaseByTag(entry.repo, version);
  return buildOptionFromRelease(entry, release);
};

const VERSIONS_PAGE_SIZE = 10;

export const fetchCustomProtonBuildVersionsPage = async (
  entry: CustomProtonBuildGithubEntry | CustomProtonBuildActionsEntry,
  page: number
): Promise<CustomProtonBuildVersionsPage> => {
  if (entry.kind === "github-actions") {
    return listGithubActionsVersions(entry, page);
  }

  try {
    return await withShortLivedCache(
      `releases-page:${entry.repo}:${page}`,
      async () => {
        const { data } = await axios.get<GithubRelease[]>(
          `${GITHUB_API}/repos/${entry.repo}/releases?per_page=${VERSIONS_PAGE_SIZE}&page=${page}`,
          { headers: githubHeaders, timeout: GITHUB_API_TIMEOUT_MS }
        );

        const versions = data
          .filter(
            (release) =>
              !release.draft &&
              release.assets.some((asset) =>
                entry.assetPattern.test(asset.name)
              )
          )
          .map((release) => ({
            version: release.tag_name,
            htmlUrl: release.html_url,
          }));

        return {
          versions,
          nextPage: data.length === VERSIONS_PAGE_SIZE ? page + 1 : null,
        };
      }
    );
  } catch (error) {
    logger.error(`Failed to list releases for ${entry.repo}`, error);
    return { versions: [], nextPage: null };
  }
};

interface GithubWorkflowRun {
  id: number;
  run_number: number;
  html_url: string;
  status: string;
  conclusion: string | null;
}

const fetchWorkflowRuns = async (
  entry: CustomProtonBuildActionsEntry,
  page: number,
  perPage: number
): Promise<GithubWorkflowRun[]> =>
  withShortLivedCache(
    `workflow-runs:${entry.repo}:${entry.workflowFile}:${page}:${perPage}`,
    async () => {
      const { data } = await axios.get<{ workflow_runs: GithubWorkflowRun[] }>(
        `${GITHUB_API}/repos/${entry.repo}/actions/workflows/${entry.workflowFile}/runs?status=success&per_page=${perPage}&page=${page}`,
        { headers: githubHeaders, timeout: GITHUB_API_TIMEOUT_MS }
      );
      return data.workflow_runs;
    }
  );

const buildOptionFromWorkflowRun = (
  entry: CustomProtonBuildActionsEntry,
  run: GithubWorkflowRun | null
): ResolvedCustomProtonBuildOption => {
  if (!run) {
    return {
      id: entry.id,
      name: entry.name,
      repo: entry.repo,
      kind: "link",
      downloadUrl: null,
      fileName: null,
      version: null,
      htmlUrl: null,
      linkUrl: `https://github.com/${entry.repo}/actions/workflows/${entry.workflowFile}`,
    };
  }

  return {
    id: entry.id,
    name: entry.name,
    repo: entry.repo,
    kind: "github-actions",
    downloadUrl: `https://nightly.link/${entry.repo}/actions/runs/${run.id}/${entry.artifactName}.zip`,
    fileName: `${entry.artifactName}.zip`,
    version: String(run.run_number),
    htmlUrl: run.html_url,
    linkUrl: null,
  };
};

const resolveGithubActionsOption = async (
  entry: CustomProtonBuildActionsEntry
): Promise<ResolvedCustomProtonBuildOption> => {
  try {
    const runs = await fetchWorkflowRuns(entry, 1, 1);
    return buildOptionFromWorkflowRun(entry, runs[0] ?? null);
  } catch (error) {
    logger.error(`Failed to fetch workflow runs for ${entry.repo}`, error);
    return buildOptionFromWorkflowRun(entry, null);
  }
};

const WORKFLOW_RUN_VERSION_SEARCH_PAGES = 5;

const resolveGithubActionsOptionForVersion = async (
  entry: CustomProtonBuildActionsEntry,
  version: string
): Promise<ResolvedCustomProtonBuildOption> => {
  try {
    for (let page = 1; page <= WORKFLOW_RUN_VERSION_SEARCH_PAGES; page++) {
      const runs = await fetchWorkflowRuns(entry, page, VERSIONS_PAGE_SIZE);
      const match = runs.find((run) => String(run.run_number) === version);
      if (match) return buildOptionFromWorkflowRun(entry, match);
      if (runs.length < VERSIONS_PAGE_SIZE) break;
    }
  } catch (error) {
    logger.error(
      `Failed to find workflow run #${version} for ${entry.repo}`,
      error
    );
  }

  return buildOptionFromWorkflowRun(entry, null);
};

const listGithubActionsVersions = async (
  entry: CustomProtonBuildActionsEntry,
  page: number
): Promise<CustomProtonBuildVersionsPage> => {
  try {
    const runs = await fetchWorkflowRuns(entry, page, VERSIONS_PAGE_SIZE);
    return {
      versions: runs.map((run) => ({
        version: String(run.run_number),
        htmlUrl: run.html_url,
      })),
      nextPage: runs.length === VERSIONS_PAGE_SIZE ? page + 1 : null,
    };
  } catch (error) {
    logger.error(`Failed to list workflow runs for ${entry.repo}`, error);
    return { versions: [], nextPage: null };
  }
};

const resolveLinkOption = (
  entry: CustomProtonBuildLinkEntry
): ResolvedCustomProtonBuildOption => ({
  id: entry.id,
  name: entry.name,
  repo: entry.repo,
  kind: "link" as CustomProtonBuildKind,
  downloadUrl: null,
  fileName: null,
  version: null,
  htmlUrl: null,
  linkUrl: entry.linkUrl,
});

export const resolveCustomProtonBuildOption = (
  entry: CustomProtonBuildEntry
): Promise<ResolvedCustomProtonBuildOption> => {
  if (entry.kind === "link") {
    return Promise.resolve(resolveLinkOption(entry));
  }
  if (entry.kind === "github-actions") {
    return resolveGithubActionsOption(entry);
  }

  return resolveGithubReleaseOption(entry);
};

export const findCatalogEntry = (
  buildId: CustomProtonBuildId
): CustomProtonBuildEntry | undefined =>
  CUSTOM_PROTON_BUILD_CATALOG.find((entry) => entry.id === buildId);

export const resolveAllCustomProtonBuildOptions = async (): Promise<
  ResolvedCustomProtonBuildOption[]
> => {
  const results = await Promise.allSettled(
    CUSTOM_PROTON_BUILD_CATALOG.map((entry) =>
      resolveCustomProtonBuildOption(entry)
    )
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    const entry = CUSTOM_PROTON_BUILD_CATALOG[index];
    logger.error(
      `Failed to resolve custom Proton build option ${entry.id}`,
      result.reason
    );
    return resolveLinkOption(
      entry.kind === "link"
        ? entry
        : {
            id: entry.id,
            name: entry.name,
            repo: entry.repo,
            kind: "link",
            linkUrl:
              entry.kind === "github-actions"
                ? `https://github.com/${entry.repo}/actions/workflows/${entry.workflowFile}`
                : `https://github.com/${entry.repo}/releases`,
          }
    );
  });
};
