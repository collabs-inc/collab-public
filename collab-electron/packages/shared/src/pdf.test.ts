import { describe, test, expect } from "bun:test";
import { isPdfFile } from "./pdf";

describe("isPdfFile", () => {
  test("recognizes .pdf extension", () => {
    expect(isPdfFile("document.pdf")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPdfFile("document.PDF")).toBe(true);
    expect(isPdfFile("document.Pdf")).toBe(true);
  });

  test("rejects non-pdf files", () => {
    expect(isPdfFile("file.txt")).toBe(false);
    expect(isPdfFile("file.md")).toBe(false);
    expect(isPdfFile("file.png")).toBe(false);
    expect(isPdfFile("file.docx")).toBe(false);
  });

  test("rejects files without extension", () => {
    expect(isPdfFile("Makefile")).toBe(false);
    expect(isPdfFile("README")).toBe(false);
  });

  test("handles paths with directories", () => {
    expect(isPdfFile("/path/to/document.pdf")).toBe(true);
    expect(isPdfFile("/path/to/file.txt")).toBe(false);
  });

  test("handles paths with spaces", () => {
    expect(isPdfFile("/path/to/my document.pdf")).toBe(true);
  });
});
