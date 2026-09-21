// 列出首屏闭包中最大的 15 个 chunk（按字节）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = "packages/desktop/out/renderer/assets";
const indexHtml = readFileSync("packages/desktop/out/renderer/index.html", "utf8");
const entry = indexHtml.match(/src="\.\/assets\/([^"]+\.js)"/)[1];
const queue = [entry];
const seen = new Set(queue);
const sizes = [];
while (queue.length > 0) {
  const name = queue.shift();
  const file = join(assetsDir, name);
  sizes.push({ name, size: statSync(file).size });
  const content = readFileSync(file, "utf8");
  for (const m of content.matchAll(/from"\.\/([^"]+\.js)"/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      queue.push(m[1]);
    }
  }
}
sizes.sort((a, b) => b.size - a.size);
for (const { name, size } of sizes.slice(0, 15)) {
  console.log(`${(size / 1024).toFixed(1).padStart(9)} KiB  ${name}`);
}
console.log(`total initial: ${(sizes.reduce((s, x) => s + x.size, 0) / 1024).toFixed(0)} KiB`);
