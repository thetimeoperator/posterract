/**
 * Stands in for `electron` when a main-process module is unit tested under
 * plain node. Only the surface the tested modules touch is provided.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.env.POSTERRACT_TEST_USER_DATA ?? join(tmpdir(), "posterract-test-userdata");

export const app = {
  getPath: (name: string) => (name === "userData" ? root : tmpdir()),
  getAppPath: () => process.cwd(),
  getVersion: () => "0.0.0-test",
};
