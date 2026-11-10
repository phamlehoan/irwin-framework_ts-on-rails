/** @type {import('ts-jest').JestConfigWithTsJest} */
const ts = require("typescript");
const { pathsToModuleNameMapper } = require("ts-jest");

// Single source of truth for aliases: tsconfig.json `paths` (JSONC, so parse via the TS API).
const { config } = ts.readConfigFile("./tsconfig.json", ts.sys.readFile);

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: pathsToModuleNameMapper(config.compilerOptions.paths, {
    prefix: "<rootDir>/",
  }),
};
