const core = require("@actions/core");
const github = require("@actions/github");
const { Octokit } = require("@octokit/rest");
const { validateAnnotationsArray } = require("./validateAnnotationsArray");
const { validateImagesArray } = require("./validateImagesArray");

// Pro-Tip: create a grouping so its easily to manage the output
core.startGroup("setup variables and client");
const successStates = ["neutral", "success"];

const owner = process.env.GITHUB_REPOSITORY.split("/")[0];
const repo = process.env.GITHUB_REPOSITORY.split("/")[1];

// When we use getInput, if there is no value, it comes back as an empty string. We must assume that empty strings are null and check/test appropriately
const status = core.getInput("status");
const title = core.getInput("title");
const details = core.getInput("details");
const summary = core.getInput("summary");
const conclusion = core.getInput("conclusion");
const existingCheckRunId = core.getInput("check-run-id");
const images = core.getInput("images");
const annotations = core.getInput("annotations");
const token = core.getInput("github-token");

// initiate the client with the token
const octokit = new Octokit({
  auth: token,
});

// Test inputs and if they fall back to defaults, inform the user that we've made an assumption here
let name = core.getInput("name");
if (name == "") {
  // we're creating a warning for the property and advising to the default
  core.warning("no name set, using repo name");
  name = github.context.repo.name;
}

const pull_request = github.context.payload.pull_request;
let commitSha = "";
if (pull_request !== undefined) {
  commitSha = pull_request.head_sha;
}

if (commitSha == "" || commitSha === undefined) {
  // we're creating a warning for the property and advising to the default
  core.warning("no pull request detected, using head sha");
  commitSha = github.context.sha;
}

// get the value for the neutral
let shouldFailForNeutral = core.getInput("fail-on-neutral");
// does a value exist
if (shouldFailForNeutral !== "") {
  // is it true
  if (shouldFailForNeutral === "true") {
    shouldFailForNeutral = true;
    // is it false
  } else if (shouldFailForNeutral === "false") {
    shouldFailForNeutral = false;
  } else {
    // raise warning if nothing set
    core.warning(
      "unknown value set for fail-on-neutral property, defaulting to false"
    );
    shouldFailForNeutral = false;
  }
} else {
  core.warning("nothing set for fail-on-neutral property, defaulting to false");
  shouldFailForNeutral = false;
}

let shouldFailForNonSuccess = core.getInput("fail-on-error");
if (shouldFailForNonSuccess !== "") {
  if (shouldFailForNonSuccess === "true") {
    shouldFailForNonSuccess = true;
  } else if (shouldFailForNonSuccess === "false") {
    shouldFailForNonSuccess = false;
  } else {
    core.warning(
      "unknown value set for fail-on-error property, defaulting to false"
    );
    shouldFailForNonSuccess = false;
  }
} else {
  core.warning("nothing set for fail-on-error property, defaulting to false");
  shouldFailForNonSuccess = false;
}

core.endGroup();

// run async
async function run() {
  core.startGroup("validate failure options");
  if (conclusion !== "") {
    if (shouldFailForNonSuccess && !successStates.includes(conclusion)) {
      core.setFailed("check failed for non successive state");
    }
    if (shouldFailForNeutral && conclusion == "neutral") {
      core.setFailed("check failed for non successive state");
    }
  }
  core.endGroup();

  try {
    core.startGroup("construct payload");

    let checkRunId = 0;

    let body = {
      owner,
      repo,
      name,
      head_sha: commitSha,
      status,
      output: {
        title,
        summary,
        text: details,
      },
    };

    if (conclusion !== "") {
      core.info("conclusion detected");
      core.debug(conclusion);
      body.conclusion = conclusion;
    }

    core.endGroup();

    core.startGroup("validate annotations and images");

    if (core.isDebug()) {
      core.debug(annotations);
    }

    // Parse to JSON to handle safely
    const annotationsAsJson = JSON.parse(annotations);
    const annotationValidationErrors =
      validateAnnotationsArray(annotationsAsJson);

    if (annotationValidationErrors.length <= 0) {
      core.info("successfully validated annotations");
      body.output.annotations = annotationsAsJson;
    } else {
      core.error(annotationValidationErrors.join(" \n "));
      core.debug(annotationsAsJson);
      core.warning("Annotations parsing error, did not add");
    }

    if (core.isDebug()) {
      core.debug(images);
    }

    if (images) {
      // Parse to JSON to handle safely
      const imageAsJson = JSON.parse(images);
      const imageValidationErrors = validateImagesArray(imageAsJson);

      if (imageValidationErrors.length <= 0) {
        core.info("successfully validated images");
        body.output.images = imageAsJson;
      } else {
        core.warning("Images parsing error, did not add");
      }
    }

    core.endGroup();

    core.startGroup("run command");
    if (existingCheckRunId === "") {
      core.info("creating a check run");
      // Create the check
      const createCheck = await octokit.checks.create(body);
      checkRunId = createCheck.data.id;
      core.info(`created a check run with the id of ${checkRunId}`);
    } else {
      core.info("updating a check run");
      // add the existing check id
      body.check_run_id = existingCheckRunId;

      // update the check
      const updateCheck = await octokit.checks.update(body);
      checkRunId = updateCheck.data.id;
      core.info(`updated a check run with the id of ${checkRunId}`);
    }
    core.setOutput("check-run-id", checkRunId);

    core.info("action was successful");

    core.endGroup();
  } catch (error) {
    if (error.includes("Resource not accessible by integration")) {
      core.error(
        "Ensure permissions are correct, was not able to create check"
      );
    } else {
      core.error(`Error ${error}, action did not succeed`);
    }
  }
}

run();
