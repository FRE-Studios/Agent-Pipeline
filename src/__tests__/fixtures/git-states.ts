// Git state fixtures for testing GitManager

export const cleanRepositoryState = {
  isClean: true,
  files: [],
  staged: [],
  modified: [],
  latest: {
    hash: 'abc123def456',
    message: 'Initial commit',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: '',
};

export const dirtyRepositoryState = {
  isClean: false,
  files: ['file1.ts', 'file2.ts'],
  staged: ['file1.ts'],
  modified: ['file2.ts'],
  latest: {
    hash: 'abc123def456',
    message: 'Previous commit',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: 'file1.ts\nfile2.ts',
};

export const stagedChangesState = {
  isClean: false,
  files: [],
  staged: ['staged-file.ts'],
  modified: [],
  latest: {
    hash: 'def789abc012',
    message: 'Some changes',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: 'staged-file.ts',
};

export const unstagedChangesState = {
  isClean: false,
  files: ['unstaged-file.ts'],
  staged: [],
  modified: ['unstaged-file.ts'],
  latest: {
    hash: 'ghi345jkl678',
    message: 'More changes',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: 'unstaged-file.ts',
};

export const freshRepositoryState = {
  isClean: true,
  files: [],
  staged: [],
  modified: [],
  latest: null,
  diffOutput: '',
};

export const multipleFilesChangedState = {
  isClean: false,
  files: ['src/core/file1.ts', 'src/utils/file2.ts', 'tests/test.ts'],
  staged: ['src/core/file1.ts'],
  modified: ['src/utils/file2.ts', 'tests/test.ts'],
  latest: {
    hash: 'multi123abc456',
    message: 'Multiple file changes',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: 'src/core/file1.ts\nsrc/utils/file2.ts\ntests/test.ts',
};

export const singleFileChangedState = {
  isClean: false,
  files: ['README.md'],
  staged: [],
  modified: ['README.md'],
  latest: {
    hash: 'readme123abc',
    message: 'Update README',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: 'README.md',
};

export const filesWithSpacesState = {
  isClean: false,
  files: ['file with spaces.ts', 'another file.md'],
  staged: ['file with spaces.ts'],
  modified: ['another file.md'],
  latest: {
    hash: 'spaces123abc',
    message: 'Files with spaces',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: 'file with spaces.ts\nanother file.md',
};

export const commitWithMetadata = {
  isClean: true,
  files: [],
  staged: [],
  modified: [],
  latest: {
    hash: 'meta123def456',
    message: '[pipeline:test-stage] Apply test-stage changes\n\nAgent-Pipeline: true\nPipeline-Run-ID: run-12345\nPipeline-Stage: test-stage',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: '',
};

export const multiLineCommitMessage = {
  isClean: true,
  files: [],
  staged: [],
  modified: [],
  latest: {
    hash: 'multiline123',
    message: 'First line of commit\n\nDetailed description here\nWith multiple lines\n\nTrailer-Key: trailer-value',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: '',
};

export const emptyCommitMessage = {
  isClean: true,
  files: [],
  staged: [],
  modified: [],
  latest: {
    hash: 'empty123abc',
    message: '',
    author_name: 'Test Author',
    author_email: 'test@example.com',
  },
  diffOutput: '',
};
