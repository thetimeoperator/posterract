// The one thing the command matcher takes from cmdk-solid, for tests that run
// in Node: the package's only entry also loads Kobalte, which will not load
// outside a browser. A plain substring score stands in for cmdk's fuzzy one —
// the matcher's own rules (exact names, prefixes, the margin) are what the
// tests are about.
export const defaultFilter = (value: string, search: string): number => (value.includes(search) ? 0.5 : 0);
