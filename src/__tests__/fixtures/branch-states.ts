// Branch state fixtures for testing BranchManager

export const mainBranchState = {
  current: 'main',
  all: ['main'],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const pipelineBranchExists = {
  current: 'pipeline/test-pipeline',
  all: ['main', 'pipeline/test-pipeline'],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const multiplePipelineBranches = {
  current: 'main',
  all: [
    'main',
    'develop',
    'pipeline/test-pipeline',
    'pipeline/build-pipeline',
    'pipeline/deploy-pipeline',
    'feature/new-feature',
  ],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const noPipelineBranches = {
  current: 'main',
  all: ['main', 'develop', 'feature/test', 'bugfix/issue-123'],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const customPrefixBranches = {
  current: 'main',
  all: [
    'main',
    'custom/test-pipeline',
    'custom/build-pipeline',
    'feature/test',
  ],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const detachedHeadState = {
  current: '',
  all: ['main', 'pipeline/test-pipeline'],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const singlePipelineBranch = {
  current: 'pipeline/single',
  all: ['main', 'pipeline/single'],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const uniquePerRunBranches = {
  current: 'main',
  all: [
    'main',
    'pipeline/test-pipeline/abc12345',
    'pipeline/test-pipeline/def67890',
    'pipeline/build-pipeline/ghi11111',
  ],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const emptyBranchList = {
  current: 'main',
  all: [],
  isClean: true,
  files: [],
  staged: [],
  modified: [],
};

export const dirtyPipelineBranch = {
  current: 'pipeline/test-pipeline',
  all: ['main', 'pipeline/test-pipeline'],
  isClean: false,
  files: ['changed-file.ts'],
  staged: ['changed-file.ts'],
  modified: [],
};
