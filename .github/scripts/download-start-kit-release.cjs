module.exports = async ({ github, context, core }) => {
  const releaseVersion = process.env.START_KIT_VERSION;
  const outputDir = process.env.BUILD_DIRECTORY;
  const github_token = process.env.PAT_GITHUB;

  let release;

  if (releaseVersion === "latest") {
    const { data: latestRelease } = await github.rest.repos.getLatestRelease({
      owner: "G-Core",
      repo: "create-fastedge-app",
    });
    release = latestRelease;
  } else {
    const { data: specificRelease } = await github.rest.repos.getReleaseByTag({
      owner: "G-Core",
      repo: "create-fastedge-app",
      tag: releaseVersion,
    });
    release = specificRelease;
  }

  const resource = release.assets.find((asset) =>
    asset.name.endsWith("resources.ts"),
  );
  if (!resource) {
    core.setFailed("No resources.ts asset found in the release.");
    return;
  }

  const resourceSha = release.assets.find((asset) =>
    asset.name.endsWith("resources.ts.sha256"),
  );
  if (!resourceSha) {
    core.setFailed("No resources.ts.sha256 asset found in the release.");
    return;
  }

  const { execSync } = require("child_process");
  const fs = require("fs");

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Download the assets
  const downloadAsset = (asset) => {
    const downloadUrl = `https://api.github.com/repos/G-Core/create-fastedge-app/releases/assets/${asset.id}`;
    core.info(`Assets download URL: ${downloadUrl}`);

    execSync(
      `curl -L "${downloadUrl}" -H "Authorization: Bearer ${github_token}" -H "Accept: application/octet-stream" -H "X-GitHub-Api-Version: 2022-11-28" -o "./${outputDir}/${asset.name}"`,
    );
  };

  downloadAsset(resource);
  downloadAsset(resourceSha);

  core.info(`RELEASE_ASSET_VERSION: ${release.tag_name}`);
  core.info(`Release downloaded successfully to ${outputDir}`);
  core.setOutput("RELEASE_ASSET_VERSION", release.tag_name);
};
