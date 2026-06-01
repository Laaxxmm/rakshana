import { describe, expect, it } from "vitest";
import { parseCsv, rowsToObjects } from "./parse";

describe("parseCsv", () => {
  it("parses a simple comma-separated row", () => {
    const out = parseCsv("name,pan\nAnkita,ABCDE1234F\nRavi,XYZAB9876C\n");
    expect(out.headers).toEqual(["name", "pan"]);
    expect(out.rows).toEqual([
      ["Ankita", "ABCDE1234F"],
      ["Ravi", "XYZAB9876C"],
    ]);
  });

  it("handles quoted cells with embedded commas", () => {
    const out = parseCsv('name,address\n"Doe, John","12 Lavelle Rd, Bengaluru"\n');
    expect(out.rows).toEqual([["Doe, John", "12 Lavelle Rd, Bengaluru"]]);
  });

  it("handles escaped quotes inside quoted cells", () => {
    const out = parseCsv('name\n"She said ""hi"""\n');
    expect(out.rows).toEqual([['She said "hi"']]);
  });

  it("skips entirely blank lines", () => {
    const out = parseCsv("name\nAnkita\n\n\nRavi\n");
    expect(out.rows).toEqual([["Ankita"], ["Ravi"]]);
  });

  it("strips BOM", () => {
    const out = parseCsv("﻿name,pan\nAnkita,ABCDE1234F");
    expect(out.headers).toEqual(["name", "pan"]);
    expect(out.rows).toEqual([["Ankita", "ABCDE1234F"]]);
  });

  it("handles CRLF line endings", () => {
    const out = parseCsv("name,pan\r\nAnkita,ABCDE1234F\r\nRavi,XYZAB9876C\r\n");
    expect(out.rows).toEqual([
      ["Ankita", "ABCDE1234F"],
      ["Ravi", "XYZAB9876C"],
    ]);
  });

  it("handles embedded newlines in quoted cells", () => {
    const out = parseCsv('name,address\n"Doe","12 Lavelle\nBengaluru"\n');
    expect(out.rows).toEqual([["Doe", "12 Lavelle\nBengaluru"]]);
  });

  it("rowsToObjects keys rows by header names", () => {
    const out = parseCsv("name,pan\nAnkita,ABCDE1234F");
    expect(rowsToObjects(out)).toEqual([
      { name: "Ankita", pan: "ABCDE1234F" },
    ]);
  });

  it("rowsToObjects fills missing cells with empty string", () => {
    const out = parseCsv("name,pan,phone\nAnkita,ABCDE1234F");
    expect(rowsToObjects(out)).toEqual([
      { name: "Ankita", pan: "ABCDE1234F", phone: "" },
    ]);
  });
});
