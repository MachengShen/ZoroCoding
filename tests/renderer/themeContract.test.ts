import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER_ROOT = resolve("src/renderer");
const SCANNED_EXTENSIONS = new Set([".css", ".ts", ".tsx", ".svg"]);
const APPROVED_COLORS = new Set(["#000000", "#c9ff62"]);
const FORBIDDEN_COLOR_NAMES = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "transparent",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "selecteditem",
  "selecteditemtext",
  "visitedtext",
  "activeborder",
  "activecaption",
  "appworkspace",
  "background",
  "buttonhighlight",
  "buttonshadow",
  "captiontext",
  "inactiveborder",
  "inactivecaption",
  "inactivecaptiontext",
  "infobackground",
  "infotext",
  "menu",
  "menutext",
  "scrollbar",
  "threeddarkshadow",
  "threedface",
  "threedhighlight",
  "threedlightshadow",
  "threedshadow",
  "window",
  "windowframe",
  "windowtext",
] as const;
const FORBIDDEN_COLOR_NAME_SOURCE = FORBIDDEN_COLOR_NAMES.join("|");
const REQUIRED_SURFACES = [
  ".app-loading",
  ".activity-feed",
  ".quick-chat-feed",
  ".terminal-output",
  ".code-patch",
  ".modal",
  ".provider-sheet",
  ".storage-blocker",
  ".error-toast",
] as const;

async function rendererFiles(directory = RENDERER_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return rendererFiles(path);
      }
      return SCANNED_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat().sort();
}

function stripComments(source: string): string {
  let result = "";
  let state:
    | "code"
    | "single-quote"
    | "double-quote"
    | "template"
    | "line-comment"
    | "block-comment" = "code";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        result += character;
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "\n") {
        result += character;
      } else if (character === "*" && next === "/") {
        index += 1;
        state = "code";
      }
      continue;
    }

    if (state !== "code") {
      result += character;
      if (character === "\\" && next !== undefined) {
        result += next;
        index += 1;
        continue;
      }
      if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "'") {
      state = "single-quote";
      result += character;
    } else if (character === '"') {
      state = "double-quote";
      result += character;
    } else if (character === "`") {
      state = "template";
      result += character;
    } else if (
      character === "/" &&
      next === "/" &&
      source[index - 1] !== ":"
    ) {
      state = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
    } else {
      result += character;
    }
  }

  return result;
}

interface CssDeclaration {
  property: string;
  value: string;
  index: number;
}

function cssDeclarations(source: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  for (const match of source.matchAll(
    /([-\w]+)\s*:\s*([^;{}]+)(?:;|$|(?=}))/g,
  )) {
    if (
      match.index !== undefined &&
      match[1] !== undefined &&
      match[2] !== undefined
    ) {
      declarations.push({
        property: match[1].toLowerCase(),
        value: match[2].trim(),
        index: match.index,
      });
    }
  }
  return declarations;
}

function atLine(source: string, index: number, detail: string): string {
  return `line ${source.slice(0, index).split("\n").length}: ${detail}`;
}

function approvedCssVariables(
  declarations: readonly CssDeclaration[],
  allowsApprovedLiterals: boolean,
): Set<string> {
  const approved = new Set(["--zoro-black", "--zoro-green"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!declaration.property.startsWith("--") || approved.has(declaration.property)) {
        continue;
      }
      const value = declaration.value.trim();
      const literalAllowed =
        allowsApprovedLiterals && APPROVED_COLORS.has(value.toLowerCase());
      const variable = value.match(/^var\(\s*(--[-\w]+)\s*\)$/i)?.[1];
      if (
        literalAllowed ||
        /^currentColor$/i.test(value) ||
        (variable !== undefined && approved.has(variable))
      ) {
        approved.add(declaration.property);
        changed = true;
      }
    }
  }
  return approved;
}

function isPaintProperty(property: string): boolean {
  if (
    /^(?:color|background|background-color|background-image|border|border-color|border-image|border-image-source|outline|outline-color|accent-color|caret-color|fill|stroke|stop-color|flood-color|lighting-color|text-decoration-color|text-emphasis-color|column-rule|column-rule-color|mask|mask-image|-webkit-mask|-webkit-mask-image|list-style-image|-webkit-text-fill-color|-webkit-text-stroke|-webkit-text-stroke-color)$/u.test(
      property,
    )
  ) {
    return true;
  }
  return /^border-(?:top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end)(?:-color)?$/u.test(
    property,
  );
}

function isOpacityProperty(property: string): boolean {
  return /^(?:opacity|fill-opacity|stroke-opacity|stop-opacity|flood-opacity)$/u.test(
    property,
  );
}

function isFilterProperty(property: string): boolean {
  return /^(?:-(?:webkit|moz)-)?(?:filter|backdrop-filter)$/u.test(property);
}

function withoutImportant(value: string): string {
  return value.replace(/\s*!important\s*$/iu, "").trim();
}

function hasPaintImageSource(value: string): boolean {
  return /\b[-a-z]*gradient\s*\(|\burl\s*\(/iu.test(value);
}

interface InlineStyleDeclaration extends CssDeclaration {
  dynamic: boolean;
}

function inlineStyleDeclarations(source: string): InlineStyleDeclaration[] {
  const declarations: InlineStyleDeclaration[] = [];
  for (const match of source.matchAll(
    /style\s*=\s*\{\s*\{([\s\S]*?)\}\s*\}/g,
  )) {
    if (match.index === undefined || match[1] === undefined) {
      continue;
    }
    const body = match[1];
    const bodyIndex = match.index + match[0].indexOf(body);
    for (const propertyMatch of body.matchAll(
      /(?:"([^"]+)"|'([^']+)'|([A-Za-z][\w-]*))\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^,}]+))/g,
    )) {
      const propertyName =
        propertyMatch[1] ?? propertyMatch[2] ?? propertyMatch[3];
      if (propertyMatch.index === undefined || propertyName === undefined) {
        continue;
      }
      const property = propertyName.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`,
      );
      const dynamicValue = propertyMatch[7];
      declarations.push({
        property: property.toLowerCase(),
        value: (
          propertyMatch[4] ??
          propertyMatch[5] ??
          propertyMatch[6] ??
          dynamicValue ??
          ""
        ).trim(),
        index: bodyIndex + propertyMatch.index,
        dynamic:
          dynamicValue !== undefined &&
          !/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(dynamicValue.trim()),
      });
    }
  }
  for (const match of source.matchAll(
    /style\s*=\s*(["'])([\s\S]*?)\1/g,
  )) {
    if (match.index === undefined || match[2] === undefined) {
      continue;
    }
    const body = match[2];
    const bodyIndex = match.index + match[0].indexOf(body);
    declarations.push(
      ...cssDeclarations(body).map((declaration) => ({
        ...declaration,
        index: bodyIndex + declaration.index,
        dynamic: false,
      })),
    );
  }
  return declarations;
}

function paintValueViolation(
  value: string,
  approvedVariables: ReadonlySet<string>,
): string | null {
  if (
    /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)\s*\(/i.test(
      value,
    ) ||
    /\b[-a-z]*gradient\s*\(/i.test(value) ||
    /\burl\s*\(/i.test(value)
  ) {
    return value;
  }
  const forbiddenName = value.match(
    new RegExp(
      `(?<![-\\w])(?:${FORBIDDEN_COLOR_NAME_SOURCE})(?![-\\w])`,
      "i",
    ),
  );
  if (forbiddenName !== null) {
    return forbiddenName[0];
  }
  const variables = Array.from(
    value.matchAll(/var\(\s*(--[-\w]+)(?:\s*,[^)]*)?\)/gi),
    (match) => match[1],
  );
  if (
    variables.some(
      (variable): boolean =>
        variable === undefined || !approvedVariables.has(variable),
    )
  ) {
    return value;
  }
  const remainder = value
    .replace(/var\(\s*--[-\w]+(?:\s*,[^)]*)?\)/gi, "")
    .replace(/\bcurrentColor\b/gi, "")
    .replace(/\bnone\b/gi, "")
    .replace(/\b(?:solid|dashed|dotted|double)\b/gi, "")
    .replace(/(?:^|\s)0(?:\s|$)/g, " ")
    .replace(/\b\d*\.?\d+(?:px|rem|em|%)?\b/gi, "")
    .replace(/!important/gi, "")
    .replace(/\s+/g, "");
  return remainder.length === 0 ? null : value;
}

function ruleFor(source: string, selector: string): string | undefined {
  for (const match of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      ?.split(",")
      .map((candidate) => candidate.trim());
    if (selectors?.includes(selector)) {
      return match[2];
    }
  }
  return undefined;
}

function declarationsFor(source: string, selector: string): string {
  const declarations: string[] = [];
  for (const match of stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      ?.split(",")
      .map((candidate) => candidate.trim());
    if (selectors?.includes(selector) && match[2] !== undefined) {
      declarations.push(match[2]);
    }
  }
  return declarations.join("\n");
}

function themeViolations(source: string, file: string): string[] {
  const scannedSource = stripComments(source);
  const violations: string[] = [];
  const allowsApprovedLiterals = file.replaceAll("\\", "/").endsWith(
    "src/renderer/styles.css",
  );
  for (const match of scannedSource.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    const literal = match[0].toLowerCase();
    if (
      match.index !== undefined &&
      (!allowsApprovedLiterals || !APPROVED_COLORS.has(literal))
    ) {
      violations.push(atLine(scannedSource, match.index, literal));
    }
  }

  if (file.toLowerCase().endsWith(".css")) {
    const declarations = cssDeclarations(scannedSource);
    const approvedVariables = approvedCssVariables(
      declarations,
      allowsApprovedLiterals,
    );
    const forbiddenNamePattern = new RegExp(
      `(?<![-\\w])(?:${FORBIDDEN_COLOR_NAME_SOURCE})(?![-\\w])`,
      "i",
    );
    for (const declaration of declarations) {
      const { property, value, index } = declaration;
      if (hasPaintImageSource(value)) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
        continue;
      }
      if (
        isOpacityProperty(property) &&
        !/^1(?:\.0+)?$/u.test(withoutImportant(value))
      ) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
      }
      if (
        isFilterProperty(property) &&
        !/^none$/iu.test(withoutImportant(value))
      ) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
      }
      if (/^(?:box-shadow|text-shadow)$/u.test(property)) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
      }
      if (property.startsWith("--")) {
        if (
          forbiddenNamePattern.test(value) ||
          /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)\s*\(/i.test(
            value,
          ) ||
          /\b[-a-z]*gradient\s*\(|\burl\s*\(/i.test(value)
        ) {
          violations.push(atLine(scannedSource, index, `${property}: ${value}`));
        }
        continue;
      }
      if (isPaintProperty(property)) {
        const violation = paintValueViolation(value, approvedVariables);
        if (violation !== null) {
          violations.push(atLine(scannedSource, index, `${property}: ${violation}`));
        }
      }
    }
  } else {
    const approvedVariables = new Set(["--zoro-black", "--zoro-green"]);
    for (const declaration of inlineStyleDeclarations(scannedSource)) {
      const { property, value, index, dynamic } = declaration;
      if (hasPaintImageSource(value)) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
        continue;
      }
      if (
        isOpacityProperty(property) &&
        (dynamic || !/^1(?:\.0+)?$/u.test(withoutImportant(value)))
      ) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
      }
      if (
        isFilterProperty(property) &&
        (dynamic || !/^none$/iu.test(withoutImportant(value)))
      ) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
      }
      if (/^(?:box-shadow|text-shadow)$/u.test(property)) {
        violations.push(atLine(scannedSource, index, `${property}: ${value}`));
      }
      if (isPaintProperty(property)) {
        const violation =
          dynamic ? value : paintValueViolation(value, approvedVariables);
        if (violation !== null) {
          violations.push(
            atLine(scannedSource, index, `${property}: ${violation}`),
          );
        }
      }
    }

    const paintAttributePattern =
      /\b(fill|stroke|color|stop-color|flood-color|lighting-color|stopColor|floodColor|lightingColor|filter)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^}]+))\s*\})/g;
    for (const match of scannedSource.matchAll(paintAttributePattern)) {
      if (match.index === undefined || match[1] === undefined) {
        continue;
      }
      const property = match[1];
      const bareExpression = match[7];
      const value =
        match[2] ??
        match[3] ??
        match[4] ??
        match[5] ??
        match[6] ??
        bareExpression ??
        "";
      const violation =
        bareExpression !== undefined ||
        (property.toLowerCase() === "filter"
          ? !/^none$/iu.test(value.trim())
          : paintValueViolation(value, approvedVariables) !== null);
      if (violation) {
        violations.push(atLine(scannedSource, match.index, match[0]));
      }
    }

    for (const match of scannedSource.matchAll(
      /\b(?:opacity|fill-opacity|stroke-opacity|stop-opacity|flood-opacity)\s*=\s*["']([^"']+)["']|\b(?:opacity|fillOpacity|strokeOpacity|stopOpacity|floodOpacity)\s*=\s*\{\s*([^}]+)\s*\}/gi,
    )) {
      const value = (match[1] ?? match[2] ?? "").trim();
      if (
        match.index !== undefined &&
        !/^1(?:\.0+)?$/u.test(value)
      ) {
        violations.push(atLine(scannedSource, match.index, match[0]));
      }
    }

    for (const match of scannedSource.matchAll(
      /<(?:filter|fe[A-Z]\w*|linearGradient|radialGradient)\b/g,
    )) {
      if (match.index !== undefined) {
        violations.push(atLine(scannedSource, match.index, match[0]));
      }
    }
  }

  return violations.map((violation) => `${file}:${violation}`);
}

describe("renderer theme contract", () => {
  it("allows only the approved black and green visual language", async () => {
    const violations: string[] = [];

    for (const path of await rendererFiles()) {
      const source = await readFile(path, "utf8");
      const file = relative(resolve("."), path);

      violations.push(...themeViolations(source, file));
    }

    expect(violations).toEqual([]);
  });

  it("does not interpolate paint colors or inherit a system fieldset border", async () => {
    const source = await readFile(join(RENDERER_ROOT, "styles.css"), "utf8");
    const paintTransitions = cssDeclarations(stripComments(source))
      .filter(({ property, value }) =>
        (property === "transition" || property === "transition-property") &&
        /\b(?:all|background|background-color|border|border-color|color|fill|outline|outline-color|stroke)\b/iu.test(
          value,
        ),
      )
      .map(({ property, value }) => `${property}: ${value}`);

    expect(paintTransitions).toEqual([]);
    expect(declarationsFor(source, ".routing-selection")).toContain(
      "border: 1px solid var(--zoro-green)",
    );
  });

  it.each([
    ["named magenta", ".x { color: magenta; }", "fixture.css"],
    ["system color alias", ".x { --tone: CanvasText; color: var(--tone); }", "fixture.css"],
    ["legacy WindowText", ".x { color: WindowText; }", "fixture.css"],
    ["legacy ButtonHighlight", ".x { color: ButtonHighlight; }", "fixture.css"],
    ["legacy Menu", ".x { color: Menu; }", "fixture.css"],
    ["legacy ActiveCaption", ".x { color: ActiveCaption; }", "fixture.css"],
    ["multiline paint", ".x {\n  color:\n    magenta;\n}", "fixture.css"],
    ["unknown paint alias", ".x { color: customTone; }", "fixture.css"],
    ["HWB", ".x { color: hwb(0 0% 0%); }", "fixture.css"],
    ["Lab", ".x { color: lab(50% 20 30); }", "fixture.css"],
    ["LCH", ".x { color: lch(50% 20 30); }", "fixture.css"],
    ["OKLab", ".x { color: oklab(50% 0 0); }", "fixture.css"],
    ["OKLCH", ".x { color: oklch(50% 0 0); }", "fixture.css"],
    ["color function", ".x { color: color(display-p3 1 0 0); }", "fixture.css"],
    ["color mix", ".x { color: color-mix(in srgb, #000000, #c9ff62); }", "fixture.css"],
    ["device CMYK", ".x { color: device-cmyk(0 1 1 0); }", "fixture.css"],
    ["light-dark", ".x { color: light-dark(#000000, #c9ff62); }", "fixture.css"],
    ["repeating conic gradient", ".x { background: repeating-conic-gradient(#000000, #c9ff62); }", "fixture.css"],
    ["background image gradient", ".x { background-image: linear-gradient(red, blue); }", "fixture.css"],
    ["background image paint URL", ".x { background-image: url(#paint); }", "fixture.css"],
    ["mask image gradient", ".x { mask-image: linear-gradient(red, blue); }", "fixture.css"],
    ["list image paint URL", ".x { list-style-image: url(#paint); }", "fixture.css"],
    ["border top color", ".x { border-top-color: magenta; }", "fixture.css"],
    ["logical border color", ".x { border-inline-start-color: blue; }", "fixture.css"],
    ["outline color", ".x { outline-color: magenta; }", "fixture.css"],
    ["lighting color", ".x { lighting-color: red; }", "fixture.css"],
    ["drop shadow", ".x { filter: drop-shadow(0 0 1px currentColor); }", "fixture.css"],
    ["SVG drop shadow", "<filter><feDropShadow /></filter>", "fixture.svg"],
    ["filter opacity", ".x { filter: opacity(50%); }", "fixture.css"],
    ["filter hue rotation", ".x { filter: hue-rotate(90deg); }", "fixture.css"],
    ["filter inversion", ".x { filter: invert(1); }", "fixture.css"],
    ["prefixed filter inversion", ".x { -webkit-filter: invert(1); }", "fixture.css"],
    ["prefixed backdrop filter", ".x { -webkit-backdrop-filter: blur(1px); }", "fixture.css"],
    ["SVG filter", "<filter id=\"fx\"></filter>", "fixture.svg"],
    ["SVG color matrix", "<feColorMatrix values=\"1 0 0\" />", "fixture.svg"],
    ["SVG flood", '<feFlood flood-color="currentColor" />', "fixture.svg"],
    ["alpha slash", ".x { color: var(--zoro-green) / 50%; }", "fixture.css"],
    ["SVG opacity attribute", '<path fill="currentColor" fill-opacity="0.5" />', "fixture.svg"],
    ["React SVG opacity", '<path fill="currentColor" fillOpacity={0.5} />', "fixture.tsx"],
    ["SVG named fill", '<path fill="magenta" />', "fixture.svg"],
    ["SVG named stop color", '<stop stop-color="magenta" />', "fixture.svg"],
    ["React named flood color", '<feFlood floodColor="magenta" />', "fixture.tsx"],
    ["CSS paint URL", ".x { fill: url(#paint); }", "fixture.css"],
    ["CSS stop-color URL", ".x { stop-color: url(#paint); }", "fixture.css"],
    ["React paint URL", '<path fill={"url(#paint)"} />', "fixture.tsx"],
    ["SVG style color", '<path style="stroke:magenta" />', "fixture.svg"],
    ["React style filter and opacity", '<div style={{ filter: "invert(1)", opacity: 0.5 }} />', "fixture.tsx"],
    ["React spaced style braces", '<div style={ { filter: "invert(1)", opacity: 0.5, backgroundImage: "linear-gradient(red, blue)" } } />', "fixture.tsx"],
    ["React quoted style property", '<div style={{ "filter": "invert(1)" }} />', "fixture.tsx"],
    ["React style background image", '<div style={{ backgroundImage: "linear-gradient(red, blue)" }} />', "fixture.tsx"],
    ["React style mask image", '<div style={{ maskImage: "linear-gradient(red, blue)" }} />', "fixture.tsx"],
    ["SVG style filter and opacity", '<path style="filter:invert(1);opacity:0.5" />', "fixture.svg"],
    ["approved literal outside CSS", '<path fill="#c9ff62" />', "fixture.svg"],
  ])("rejects the %s mutation", (_name, source, file) => {
    expect(themeViolations(source, file)).not.toEqual([]);
  });

  it("allows identifier text, currentColor, and token references without literal colors", () => {
    expect(
      themeViolations(
        ".blackboard { color: var(--zoro-green); background: var(--zoro-black); }",
        "fixture.css",
      ),
    ).toEqual([]);
    expect(
      themeViolations(
        '<path fill="currentColor" stroke="currentColor" />',
        "fixture.svg",
      ),
    ).toEqual([]);
    expect(
      themeViolations(
        '.label::before { content: "green"; animation-name: red; }',
        "fixture.css",
      ),
    ).toEqual([]);
    expect(
      themeViolations(
        '<div style={{ filter: "none", opacity: 1 }} />',
        "fixture.tsx",
      ),
    ).toEqual([]);
    expect(
      themeViolations(
        '<div style={ { "filter": "none", opacity: 1 } } />',
        "fixture.tsx",
      ),
    ).toEqual([]);
    expect(
      themeViolations(
        '<path style="filter:none;opacity:1;stroke:currentColor" />',
        "fixture.svg",
      ),
    ).toEqual([]);
    expect(
      themeViolations('<path filter=" none " />', "fixture.svg"),
    ).toEqual([]);
  });

  it("ignores comments and never lets them hide or fake required selectors", () => {
    expect(themeViolations("/* color: magenta; */", "fixture.css")).toEqual([]);
    expect(
      themeViolations(
        'const x = 1; // <path fill="magenta" />',
        "fixture.tsx",
      ),
    ).toEqual([]);
    const sourceWithUrls =
      'const endpoint = "https://example.com/red";\nconst template = `https://example.com/green`; // real comment';
    const strippedSource = stripComments(sourceWithUrls);
    expect(strippedSource).toContain('"https://example.com/red"');
    expect(strippedSource).toContain("`https://example.com/green`");
    expect(strippedSource).not.toContain("real comment");
    expect(themeViolations(sourceWithUrls, "fixture.tsx")).toEqual([]);
    expect(
      ruleFor(
        "/* theme note */\n.modal { background: var(--zoro-black); color: var(--zoro-green); }",
        ".modal",
      ),
    ).toBeDefined();
    expect(
      ruleFor(
        "/* .modal { background: var(--zoro-black); color: var(--zoro-green); } */",
        ".modal",
      ),
    ).toBeUndefined();
  });

  it("keeps every output and dialog surface explicitly black with green text", async () => {
    const styles = await readFile(
      resolve("src/renderer/styles.css"),
      "utf8",
    );

    expect(styles).toContain("--zoro-black: #000000;");
    expect(styles).toContain("--zoro-green: #c9ff62;");
    for (const selector of REQUIRED_SURFACES) {
      const rule = ruleFor(styles, selector);
      expect(rule, `${selector} must have its own theme rule`).toBeDefined();
      expect(rule).toMatch(/background(?:-color)?:\s*var\(--zoro-black\)/);
      expect(rule).toMatch(/color:\s*var\(--zoro-green\)/);
    }
  });

  it("fully themes form controls and the custom listbox without system colors", async () => {
    const styles = await readFile(resolve("src/renderer/styles.css"), "utf8");

    for (const selector of [
      "input",
      "textarea",
      ".custom-select-trigger",
      ".custom-select-listbox",
      ".custom-select-option",
    ]) {
      const declarations = declarationsFor(styles, selector);
      expect(declarations).toMatch(/background:\s*var\(--zoro-black\)/);
      expect(declarations).toMatch(/color:\s*var\(--zoro-green\)/);
    }
    for (const selector of ['input[type="radio"]', 'input[type="checkbox"]']) {
      const declarations = declarationsFor(styles, selector);
      expect(declarations).toMatch(/appearance:\s*none/);
      expect(declarations).toMatch(/background:\s*var\(--zoro-black\)/);
      expect(declarations).toMatch(/border:\s*1px solid var\(--zoro-green\)/);
    }
    for (const selector of [
      '.custom-select-option[data-active="true"]',
      '.custom-select-option[aria-selected="true"]',
    ]) {
      const declarations = declarationsFor(styles, selector);
      expect(declarations).toMatch(/background:\s*var\(--zoro-green\)/);
      expect(declarations).toMatch(/color:\s*var\(--zoro-black\)/);
    }
    expect(
      declarationsFor(styles, ".custom-select-indicator"),
    ).toMatch(/color:\s*var\(--zoro-green\)/);
    for (const selector of ["input::placeholder", "textarea::placeholder"]) {
      const declarations = declarationsFor(styles, selector);
      expect(declarations).toMatch(/color:\s*var\(--zoro-green\)/);
      expect(declarations).toMatch(/opacity:\s*1/);
    }
  });

  it("contains no native select or option popup in renderer components", async () => {
    const violations: string[] = [];
    for (const path of await rendererFiles()) {
      if (extname(path) !== ".tsx") {
        continue;
      }
      const source = stripComments(await readFile(path, "utf8"));
      if (/<\/?(?:select|option)\b/i.test(source)) {
        violations.push(relative(resolve("."), path));
      }
    }

    expect(violations).toEqual([]);
  });

  it("removes native number spinners and keeps the final disabled rule last", async () => {
    const styles = await readFile(resolve("src/renderer/styles.css"), "utf8");
    expect(declarationsFor(styles, 'input[type="number"]')).toMatch(
      /appearance:\s*textfield/,
    );
    expect(
      declarationsFor(styles, 'input[type="number"]::-webkit-inner-spin-button'),
    ).toMatch(/appearance:\s*none/);
    expect(
      declarationsFor(styles, 'input[type="number"]::-webkit-outer-spin-button'),
    ).toMatch(/appearance:\s*none/);

    const finalDisabled = styles.lastIndexOf(
      ".custom-select-trigger:disabled",
    );
    expect(finalDisabled).toBeGreaterThan(styles.lastIndexOf(".field input"));
    expect(finalDisabled).toBeGreaterThan(
      styles.lastIndexOf(".quick-chat-input-row"),
    );
    expect(finalDisabled).toBeGreaterThan(styles.lastIndexOf(".composer"));
    const declarations = declarationsFor(
      styles.slice(finalDisabled),
      ".custom-select-trigger:disabled",
    );
    expect(declarations).toMatch(/border:\s*1px dashed var\(--zoro-green\)/);
    expect(declarations).toMatch(/background:\s*var\(--zoro-black\)/);
    expect(declarations).toMatch(/color:\s*var\(--zoro-green\)/);
    expect(declarations).toMatch(/opacity:\s*1/);
  });

  it("keeps disabled controls black and green through hover, active, and selected states", async () => {
    const styles = await readFile(resolve("src/renderer/styles.css"), "utf8");

    for (const selector of [
      "button:disabled:hover",
      "button:disabled:active",
      "button.selected:disabled",
    ]) {
      const declarations = declarationsFor(styles, selector);
      expect(declarations).toMatch(/border:\s*1px dashed var\(--zoro-green\)/);
      expect(declarations).toMatch(/background:\s*var\(--zoro-black\)/);
      expect(declarations).toMatch(/color:\s*var\(--zoro-green\)/);
      expect(declarations).toMatch(/opacity:\s*1/);
    }
    for (const selector of [
      ".new-task-button:not(:disabled):hover",
      ".primary-button:not(:disabled):hover",
      ".send-button:not(:disabled):hover",
    ]) {
      expect(declarationsFor(styles, selector)).not.toBe("");
    }
  });

  it("uses the approved semantic shapes for routing, progress, and selection", async () => {
    const styles = await readFile(resolve("src/renderer/styles.css"), "utf8");

    expect(declarationsFor(styles, ".task-row.selected > svg")).toMatch(
      /color:\s*var\(--zoro-black\)/,
    );
    expect(declarationsFor(styles, ".route-preview-error")).toMatch(
      /border:\s*3px double var\(--zoro-green\)/,
    );
    expect(declarationsFor(styles, ".route-preview-error::before")).toMatch(
      /content:\s*"✕"/,
    );
    expect(declarationsFor(styles, ".step-completed .step-icon")).toMatch(
      /border:\s*1px solid var\(--zoro-green\)/,
    );
    expect(declarationsFor(styles, ".step-pending .step-icon")).toMatch(
      /border:\s*1px dotted var\(--zoro-green\)/,
    );
    expect(declarationsFor(styles, ".step-running .step-icon")).toMatch(
      /border:\s*1px dotted var\(--zoro-green\)/,
    );
    expect(declarationsFor(styles, ".step-failed .step-icon")).toMatch(
      /border:\s*3px double var\(--zoro-green\)/,
    );
  });
});
