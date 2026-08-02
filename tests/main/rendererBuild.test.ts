import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const temporaryBuilds: string[] = [];

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([A-Za-z][\w:-]*)=(["'])(.*?)\2/g)].map(
      ([, name, , value]) => [name, value],
    ),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryBuilds.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("production renderer build", () => {
  it("keeps packaged script and stylesheet URLs beside the file-loaded index", async () => {
    const outDir = await mkdtemp(
      path.join(tmpdir(), "zoro-renderer-build-"),
    );
    temporaryBuilds.push(outDir);
    await build({
      configFile: path.resolve("vite.config.ts"),
      build: {
        outDir,
        emptyOutDir: true,
      },
    });

    const indexPath = path.join(outDir, "index.html");
    const html = await readFile(indexPath, "utf8");
    const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
    const assetReferences = tags.flatMap((tag) => {
      const parsed = attributes(tag);
      if (
        (tag.startsWith("<script") && parsed.type === "module") ||
        (tag.startsWith("<link") && parsed.rel === "stylesheet")
      ) {
        return [parsed.src ?? parsed.href].filter(
          (value): value is string => value !== undefined,
        );
      }
      return [];
    });
    expect(assetReferences).toHaveLength(2);

    const packagedIndex = new URL(
      "file:///Volumes/ZoroTest/ZoroCoding.app/Contents/Resources/app.asar/dist-renderer/index.html",
    );
    for (const reference of assetReferences) {
      expect(path.posix.isAbsolute(reference)).toBe(false);
      const packagedAsset = new URL(reference, packagedIndex);
      expect(packagedAsset.protocol).toBe("file:");
      expect(packagedAsset.pathname).toMatch(
        /\/dist-renderer\/assets\/[^/]+\.(?:js|css)$/,
      );

      const builtAssetPath = fileURLToPath(
        new URL(reference, pathToFileURL(indexPath)),
      );
      expect((await stat(builtAssetPath)).isFile()).toBe(true);
    }
  });
});
