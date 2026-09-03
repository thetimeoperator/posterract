import assert from "node:assert/strict";
import test from "node:test";

import { outputPathFor, parseCsv } from "./batch.ts";

test("a CSV's header names its columns", () => {
  assert.deepEqual(parseCsv("name,price\nHat,10\nScarf,20\n"), [
    { name: "Hat", price: "10" },
    { name: "Scarf", price: "20" },
  ]);
});

test("quoted fields keep their commas, quotes and newlines", () => {
  const rows = parseCsv('name,tagline\n"Hat, red","He said ""hi""\nand left"\n');
  assert.equal(rows[0]!.name, "Hat, red");
  assert.equal(rows[0]!.tagline, 'He said "hi"\nand left');
});

test("CRLF rows and trailing blank lines are handled", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n\r\n"), [{ a: "1", b: "2" }]);
});

test("a missing trailing cell reads as empty, not undefined", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2\n"), [{ a: "1", b: "2", c: "" }]);
});

test("the output template fills from the row", () => {
  const path = outputPathFor("out/{name}.mp4", { name: "Hat" }, 0);
  assert.match(path, /out\/Hat\.mp4$/);
});

test("{n} is the row number, counting from one", () => {
  assert.match(outputPathFor("out/take-{n}.mp4", {}, 4), /take-5\.mp4$/);
});

/* Without this every row would write over the last one, silently. */
test("a template with no placeholder still gets one file per row", () => {
  const first = outputPathFor("out/ad.mp4", {}, 0);
  const second = outputPathFor("out/ad.mp4", {}, 1);
  assert.notEqual(first, second);
  assert.match(first, /ad-1\.mp4$/);
  assert.match(second, /ad-2\.mp4$/);
});

/* A cell becomes a filename; it must not be able to escape the directory. */
test("path separators in a cell cannot redirect the output", () => {
  const path = outputPathFor("out/{name}.mp4", { name: "../../etc/passwd" }, 0);
  assert.ok(!path.includes("/etc/passwd"), "the cell cannot introduce directories");
  assert.match(path, /out\/etcpasswd\.mp4$/, "and cannot start the name with a dot");
});

test("a cell that sanitises to nothing falls back to the row number", () => {
  assert.match(outputPathFor("out/{name}.mp4", { name: "///" }, 2), /out\/3\.mp4$/);
});

test("a template naming a column that does not exist is refused", () => {
  assert.throws(() => outputPathFor("out/{missing}.mp4", { name: "Hat" }, 0), /not a column/);
});
