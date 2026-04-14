export function isPdfFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return filePath.slice(dot).toLowerCase() === ".pdf";
}
