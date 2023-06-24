// Load tempDirectory before it gets wiped by tool-cache
let tempDirectory = process.env.RUNNER_TEMP || "";

import fs from 'fs';
import * as os from "os";
import * as path from "path";
import * as util from "util";
import * as restm from "typed-rest-client/RestClient";
import * as semver from "semver";

if (!tempDirectory) {
  let baseLocation;
  if (process.platform === "win32") {
    // On windows use the USERPROFILE env variable
    baseLocation = process.env.USERPROFILE || "C:\\";
  } else {
    if (process.platform === "darwin") {
      baseLocation = "/Users";
    } else {
      baseLocation = "/home";
    }
  }
  tempDirectory = path.join(baseLocation, "actions", "temp");
}

import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";

const osPlat: string = os.platform();
const osArch: string = os.arch();

// This regex is slighty modified from https://semver.org/ to allow only MINOR.PATCH notation.
const semverRegex2 =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/gm;
const semverRegex3 =
  // eslint-disable-next-line max-len
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/gm;

interface IProtocRelease {
  tag_name: string;
  prerelease: boolean;
}

export async function getProtoc(
  version: string,
  includePreReleases: boolean,
  repoToken: string
) {
  // resolve the version number
  const targetVersion = await computeVersion(
    "https://api.github.com/repos/protocolbuffers/protobuf/releases?page=",
    version,
    includePreReleases,
    repoToken,
    semverRegex2
  );
  if (targetVersion) {
    version = targetVersion;
  }
  process.stdout.write("Getting protoc version: " + version + os.EOL);

  // look if the binary is cached
  let toolPath: string;
  toolPath = tc.find("protoc", version);

  // if not: download, extract and cache
  if (!toolPath) {
    toolPath = await downloadRelease(version, "https://github.com/protocolbuffers/protobuf/releases/download/%s/%s", "protoc");
    process.stdout.write("Protoc cached under " + toolPath + os.EOL);
  }

  // add the bin folder to the PATH
  core.addPath(path.join(toolPath, "bin"));
}

export async function getProtocGenJS(
  version: string,
  includePreReleases: boolean,
  repoToken: string
) {
  // resolve the version number
  const targetVersion = await computeVersion(
    "https://api.github.com/repos/protocolbuffers/protobuf-javascript/releases?page=",
    version,
    includePreReleases,
    repoToken,
    semverRegex3
  );
  if (targetVersion) {
    version = targetVersion;
  }
  process.stdout.write("Getting protobuf-javascript version: " + version + os.EOL);

  // look if the binary is cached
  let toolPath: string;
  toolPath = tc.find("protobuf-javascript", version);

  // if not: download, extract and cache
  if (!toolPath) {
    toolPath = await downloadRelease(version, "https://github.com/protocolbuffers/protobuf-javascript/releases/download/%s/%s", "protobuf-javascript");
    process.stdout.write("protobuf-javascript cached under " + toolPath + os.EOL);
  }

  // add the bin folder to the PATH
  core.addPath(path.join(toolPath, "bin"));
}

export async function getProtocGenGRPCJS(
  version: string,
  includePreReleases: boolean,
  repoToken: string
) {
  // resolve the version number
  const targetVersion = await computeVersion(
    "https://api.github.com/repos/grpc/grpc-web/releases?page=",
    version,
    includePreReleases,
    repoToken,
    semverRegex3,
    false
  );
  if (targetVersion) {
    version = targetVersion;
  }
  process.stdout.write("Getting protoc+-gen-grpc-web version: " + version + os.EOL);

  // look if the binary is cached
  let toolPath: string;
  toolPath = tc.find("protoc-gen-grpc-web", version);

  // if not: download, extract and cache
  if (!toolPath) {
    toolPath = await downloadRelease(version, "https://github.com/grpc/grpc-web/releases/download/%s/%s", "protoc-gen-grpc-web", "");
    process.stdout.write("protoc-gen-grpc-web cached under " + toolPath + os.EOL);
  }

  // add the parent directory folder to the PATH
  core.addPath(path.dirname(toolPath));
}

async function downloadRelease(version: string, formatURL: string, toolName: string, extension = ".zip"): Promise<string> {
  // Download
  const fileName: string = getFileName(toolName, version, osPlat, osArch, extension);
  const downloadUrl: string = util.format(
    formatURL,
    version,
    fileName
  );
  process.stdout.write("Downloading archive: " + downloadUrl + os.EOL);

  let downloadPath: string | null = null;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (err) {
    if (err instanceof tc.HTTPError) {
      core.debug(err.message);
      throw new Error(
        `Failed to download version ${version}: ${err.name}, ${err.message} - ${err.httpStatusCode}`
      );
    }
    throw new Error(`Failed to download version ${version}: ${err}`);
  }

  if (extension === ".zip") {
    // Extract
    const extPath: string = await tc.extractZip(downloadPath);

    // Install into the local tool cache - node extracts with a root folder that matches the fileName downloaded
    return tc.cacheDir(extPath, toolName, version);
  } else {
    const toolPath = path.join(path.dirname(downloadPath), toolName);
    fs.renameSync(downloadPath, toolPath);
    fs.chmodSync(toolPath, 0o775);
    return tc.cacheDir(toolPath, toolName, version)
  }
}

/**
 *
 * @param osArc - A string identifying operating system CPU architecture for which the Node.js binary was compiled.
 * See https://nodejs.org/api/os.html#osarch for possible values.
 * @returns Suffix for the protoc filename.
 */
function fileNameSuffix(osArc: string): string {
  switch (osArc) {
    case "x64": {
      return "x86_64";
    }
    case "arm64": {
      return "aarch_64";
    }
    case "s390x": {
      return "s390_64";
    }
    case "ppc64": {
      return "ppcle_64";
    }
    default: {
      return "x86_32";
    }
  }
}

/**
 * Returns the filename of the protobuf compiler.
 *
 * @param version - The version to download
 * @param osPlatf - The operating system platform for which the Node.js binary was compiled.
 * See https://nodejs.org/api/os.html#osplatform for more.
 * @param osArc - The operating system CPU architecture for which the Node.js binary was compiled.
 * See https://nodejs.org/api/os.html#osarch for more.
 * @returns The filename of the protocol buffer for the given release, platform and architecture.
 *
 */
export function getFileName(
  toolName: string,
  version: string,
  osPlatf: string,
  osArc: string,
  extension = ".zip"
): string {
  // to compose the file name, strip the leading `v` char
  if (version.startsWith("v")) {
    version = version.slice(1, version.length);
  }
  // in case is a rc release we add the `-`
  if (version.includes("rc")) {
    version = version.replace("rc", "rc-");
  }

  // The name of the Windows package has a different naming pattern
  if (osPlatf == "win32") {
    const arch: string = osArc == "x64" ? "64" : "32";
    return util.format("%s-%s-win%s%s", toolName, version, arch, extension);
  }

  const suffix = fileNameSuffix(osArc);

  if (osPlatf == "darwin") {
    return util.format("%s-%s-osx-%s%s", toolName, version, suffix, extension);
  }

  return util.format("%s-%s-linux-%s%s", toolName, version, suffix, extension);
}

// Retrieve a list of versions scraping tags from the Github API
async function fetchVersions(
  url: string,
  includePreReleases: boolean,
  repoToken: string
): Promise<string[]> {
  let rest: restm.RestClient;
  if (repoToken != "") {
    rest = new restm.RestClient("setup-grpc-web", "", [], {
      headers: { Authorization: "Bearer " + repoToken },
    });
  } else {
    rest = new restm.RestClient("setup-grpc-web");
  }

  let tags: IProtocRelease[] = [];
  for (let pageNum = 1, morePages = true; morePages; pageNum++) {
    const p = await rest.get<IProtocRelease[]>(
      url + pageNum
    );
    const nextPage: IProtocRelease[] = p.result || [];
    if (nextPage.length > 0) {
      tags = tags.concat(nextPage);
    } else {
      morePages = false;
    }
  }

  return tags
    .filter((tag) => tag.tag_name.match(/v?\d+\.\d+(\.[\w.]+)?/g))
    .filter((tag) => includePrerelease(tag.prerelease, includePreReleases))
    .map((tag) => tag.tag_name.replace("v", ""));
}

// Compute an actual version starting from the `version` configuration param.
async function computeVersion(
  url: string,
  version: string,
  includePreReleases: boolean,
  repoToken: string,
  semverRegex: RegExp,
  includesV = true
): Promise<string> {
  // strip leading `v` char (will be re-added later)
  if (version.startsWith("v")) {
    version = version.slice(1, version.length);
  }

  // strip trailing .x chars
  if (version.endsWith(".x")) {
    version = version.slice(0, version.length - 2);
  }

  core.debug(`finding version ${version}`);

  const allVersions = await fetchVersions(url, includePreReleases, repoToken);
  const validVersions = allVersions.filter((v) => v.match(semverRegex));
  const possibleVersions = validVersions.filter((v) => v.startsWith(version));

  core.debug(`${allVersions}`);
  core.debug(`${validVersions}`);
  core.debug(`${possibleVersions}`);

  const versionMap = new Map();
  possibleVersions.forEach((v) => versionMap.set(normalizeVersion(v), v));

  const versions = Array.from(versionMap.keys())
    .sort(semver.rcompare)
    .map((v) => versionMap.get(v));

  core.debug(`evaluating ${versions.length} versions`);

  if (versions.length === 0) {
    throw new Error("unable to get latest version");
  }

  core.debug(`matched: ${versions[0]}`);

  return (includesV ? "v" : "") + versions[0];
}

// Make partial versions semver compliant.
function normalizeVersion(version: string): string {
  const preStrings = ["rc"];

  const versionPart = version.split(".");
  // drop invalid
  if (versionPart[1] == null) {
    //append minor and patch version if not available
    // e.g. 23 -> 23.0.0
    return version.concat(".0.0");
  } else {
    // handle beta and rc
    // e.g. 23.0-rc1 -> 23.0.0-rc1
    if (preStrings.some((el) => versionPart[1].includes(el))) {
      versionPart[1] = versionPart[1].replace("-rc", ".0-rc");
      return versionPart.join(".");
    }
  }

  if (versionPart[2] == null) {
    //append patch version if not available
    // e.g. 23.1 -> 23.1.0
    return version.concat(".0");
  }

  return version;
}

function includePrerelease(
  isPrerelease: boolean,
  includePrereleases: boolean
): boolean {
  return includePrereleases || !isPrerelease;
}
