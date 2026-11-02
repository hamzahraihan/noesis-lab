/**
 * Pre-commit: lint the staged TypeScript/JavaScript, nothing else.
 *
 * Deliberately not a formatter. `oxfmt --check` is not a gate in this repo
 * (the generated files are not formatter-canonical), so running a formatter
 * here would rewrite unrelated lines on every commit.
 */
export default {
  '*.{ts,tsx,js,jsx}': ['oxlint --fix'],
};
