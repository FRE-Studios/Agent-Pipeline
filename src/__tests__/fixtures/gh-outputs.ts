// Realistic GitHub CLI command outputs for testing

export const ghVersionOutput = {
  stdout: 'gh version 2.40.0 (2024-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.40.0',
};

export const ghAuthStatusOutput = {
  stdout: `✓ Logged in to github.com as testuser (keyring)
✓ Git operations for github.com configured to use https protocol.
✓ Token: gho_************************************`,
};

export const ghAuthStatusNotAuthenticated = new Error(
  'You are not logged into any GitHub hosts. Run gh auth login to authenticate.'
);

export const ghVersionNotInstalled = new Error('gh: command not found');

export const ghPrCreateSuccess = {
  stdout: `https://github.com/testuser/testrepo/pull/123

Creating pull request for feature-branch into main in testuser/testrepo

#123`,
};

export const ghPrCreateSuccessAlt = {
  stdout: `
https://github.com/org/project/pull/456
Created pull request #456
`,
};

export const ghPrCreateDraft = {
  stdout: `https://github.com/testuser/testrepo/pull/789

Creating draft pull request for feature-branch into main in testuser/testrepo

#789`,
};

export const ghPrAlreadyExistsError = new Error(
  `a pull request for branch "feature-branch" into branch "main" already exists:
https://github.com/testuser/testrepo/pull/100`
);

export const ghPrCreateGenericError = new Error(
  'GraphQL: Could not resolve to a User with the login of invaliduser. (repository.pullRequest.create)'
);

export const ghPrViewOutput = {
  stdout: `Opened by testuser about 1 hour ago

  Test PR title

  Test PR body

  https://github.com/testuser/testrepo/pull/123`,
};

export const ghPrViewNotFound = new Error('no pull requests found for branch "nonexistent-branch"');

export const ghPrCreateNoUrl = {
  stdout: 'Pull request created successfully but URL not found\n#999',
};

export const ghPrCreateNoNumber = {
  stdout: 'https://github.com/testuser/testrepo/pull/unknown\nPull request created',
};

export const ghPrCreateMinimal = {
  stdout: '#555',
};

export const ghPrCreateWithReviewers = {
  stdout: `https://github.com/testuser/testrepo/pull/200

Creating pull request for feature-branch into main in testuser/testrepo
Requesting reviews from @reviewer1, @reviewer2

#200`,
};

export const ghPrCreateWithLabels = {
  stdout: `https://github.com/testuser/testrepo/pull/300

Creating pull request for feature-branch into main in testuser/testrepo
Adding labels: enhancement, bug

#300`,
};
