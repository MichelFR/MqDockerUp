export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['@swc/jest']
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/"
  ]
};
