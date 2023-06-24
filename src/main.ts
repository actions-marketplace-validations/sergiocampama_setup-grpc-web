import * as core from "@actions/core";
import * as installer from "./installer";

async function run() {
  try {
    const version = core.getInput("version");
    const versionJS = core.getInput("version-js");
    const versionGRPCJS = core.getInput("version-grpc-js");
    const includePreReleases = convertToBoolean(
      core.getInput("include-pre-releases")
    );
    const repoToken = core.getInput("repo-token");
    await installer.getProtoc(version, includePreReleases, repoToken);
    await installer.getProtocGenJS(versionJS, includePreReleases, repoToken);
    await installer.getProtocGenGRPCJS(versionGRPCJS, includePreReleases, repoToken);
  } catch (error) {
    core.setFailed(`${error}`);
  }
}

run();

function convertToBoolean(input: string): boolean {
  try {
    return JSON.parse(input);
  } catch (e) {
    return false;
  }
}
