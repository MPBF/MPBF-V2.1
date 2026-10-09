/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  testTimeout: 60000,
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/shared/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Transform ESM-only packages that Jest can't handle natively
  transformIgnorePatterns: [
    "/node_modules/(?!(exceljs|archiver-utils|archiver|zip-stream|compress-commons)/)",
  ],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
    "^.+\\.js$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
};
