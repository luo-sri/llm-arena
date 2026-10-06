// 打包前把许可协议转换成 NSIS Unicode 安装包能正确显示的编码。
//
// 原因：electron-builder 默认生成 Unicode 安装包（nsis.unicode 默认 true），
// NSIS 在运行期读取 LicenseData 指定的许可协议文件时，会按 UTF-16LE 解码。
// 若文件是 UTF-8（哪怕带 BOM），许可协议页就会显示成乱码。
// 所以这里把可读可编辑的 UTF-8 源文件 build/license.txt
// 转换成 UTF-16LE 的 build/license.utf16le.txt 供打包使用。
//
// 注意：请始终编辑 build/license.txt，不要手工编辑生成物。

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.join(appDir, "build", "license.txt");
const targetFile = path.join(appDir, "build", "license.utf16le.txt");

const source = readFileSync(sourceFile, "utf-8").replace(/^\uFEFF/, "");

if (source.trim().length === 0) {
  throw new Error(`许可协议内容为空：${sourceFile}`);
}
if (source.includes("\uFFFD")) {
  throw new Error(`许可协议存在无法解码的字符（U+FFFD），请检查 ${sourceFile} 的编码`);
}

// \uFEFF 会被 utf16le 编码为 FF FE，即 UTF-16LE 的 BOM
writeFileSync(targetFile, Buffer.from(`\uFEFF${source}`, "utf16le"));

const bytes = readFileSync(targetFile);
if (bytes[0] !== 0xff || bytes[1] !== 0xfe) {
  throw new Error("生成的许可协议缺少 UTF-16LE BOM");
}

console.log(
  `[license] ${path.relative(appDir, sourceFile)} -> ${path.relative(appDir, targetFile)} ` +
    `(UTF-16LE with BOM, ${source.length} 字符 / ${bytes.length} 字节)`,
);