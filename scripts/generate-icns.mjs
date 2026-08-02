import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const iconsetPath = process.argv[2] ?? "build/ZoroCoding.iconset";
const outputPath = process.argv[3] ?? "build/icon.icns";
const entries = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
  ["ic11", "icon_16x16@2x.png"],
  ["ic12", "icon_32x32@2x.png"],
  ["ic13", "icon_128x128@2x.png"],
  ["ic14", "icon_256x256@2x.png"],
];

const chunks = entries.map(([type, filename]) => {
  const image = readFileSync(join(iconsetPath, filename));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(image.length + header.length, 4);
  return Buffer.concat([header, image]);
});

const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(body.length + header.length, 4);
writeFileSync(outputPath, Buffer.concat([header, body]));
