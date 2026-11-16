const fs = require("node:fs");
const path = require("node:path");
const {fileURLToPath} = require("node:url");

/**
 * partial の `file` をファイルに解決する。設定の `partialPaths` で規則を選ぶ。
 * - `"content"`（既定）：コンテンツのディレクトリ（`path`）から。上流と同じ
 * - `"relative"`：Astro と同じ。`./`・`../` とそれ以外の名前は書いたファイルから、`/` はプロジェクトルートから、
 *   tsconfig の `paths` の別名はその行き先から
 *
 * 境界（`content` ではコンテンツのディレクトリ、`relative` ではプロジェクトルート）の外のファイルは返さない。
 */
class PartialResolver {
    constructor(config, Scanner) {
        this.config = config;
        this.Scanner = Scanner;
        this.aliases = new TsconfigAliases(config.root);
    }

    get relative() {
        return this.config.partialPaths === "relative";
    }

    /** [fromUri] の文書に書かれた [file] の絶対パス。解決できなければ `null`。 */
    resolve(file, fromUri) {
        if (typeof file !== "string" || !file || isUncLike(file)) return null;
        const target = this.relative ? this.relativeTarget(file, fromUri) : this.contentTarget(file);
        const boundary = this.relative ? this.config.root : this.Scanner.path;
        return target && isFileInside(boundary, target) ? target : null;
    }

    contentTarget(file) {
        const relative = file.replace(/^[\\/]/, "");
        return relative && !isAbsolute(relative) ? path.join(this.Scanner.path, relative) : null;
    }

    relativeTarget(file, fromUri) {
        if (/^\.\.?([\\/]|$)/.test(file)) return fromDocument(file, fromUri);
        if (/^[\\/]/.test(file)) return path.join(this.config.root, file.slice(1));
        if (isAbsolute(file)) return null;
        // Vite と同じく、別名の行き先のうち最初に存在するもの
        const alias = this.aliases.match(file).find(fileExists);
        return alias ?? fromDocument(file, fromUri);
    }
}

/** tsconfig.json の `compilerOptions.paths` の別名。更新時刻が変わったときだけ読み直す。 */
class TsconfigAliases {
    constructor(root) {
        this.root = root;
        this.cache = null;
    }

    /** [specifier] に一致する別名の行き先（絶対パス）。 */
    match(specifier) {
        const output = [];
        for (const {prefix, suffix, wildcard, targets, base} of this.load()) {
            if (wildcard) {
                if (specifier.length < prefix.length + suffix.length) continue;
                if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
                const star = specifier.slice(prefix.length, specifier.length - suffix.length);
                for (const target of targets) output.push(path.resolve(base, target.replace("*", star)));
            } else if (specifier === prefix) {
                for (const target of targets) output.push(path.resolve(base, target));
            }
        }
        return output;
    }

    load() {
        if (!this.root) return [];
        const file = path.join(this.root, "tsconfig.json");
        let mtime;
        try {
            mtime = fs.statSync(file).mtimeMs;
        } catch {
            return [];
        }
        if (this.cache?.mtime !== mtime) this.cache = {mtime, entries: readAliases(file, new Set())};
        return this.cache.entries;
    }
}

/**
 * [file] の別名。`extends` は相対パスのものだけたどり、`paths` と `baseUrl` はそれぞれ子が親を上書きする。
 * 行き先は実際の（継承したものを含む）`baseUrl` から、なければ `paths` を書いた tsconfig のディレクトリから解決する
 * （TypeScript 4.1 以降）。`*` の前が長い（具体的な）別名から並べる（TypeScript と同じ優先順）。
 */
function readAliases(file, seen) {
    const {paths, pathsDir, baseUrl} = readOptions(file, seen);
    if (!paths) return [];
    const base = baseUrl ?? pathsDir;
    return Object.entries(paths)
        .filter(([, targets]) => Array.isArray(targets))
        .map(([pattern, targets]) => {
            const star = pattern.indexOf("*");
            return {
                prefix: star < 0 ? pattern : pattern.slice(0, star),
                suffix: star < 0 ? "" : pattern.slice(star + 1),
                wildcard: star >= 0,
                targets: targets.filter((target) => typeof target === "string"),
                base,
            };
        })
        .sort((a, b) => b.prefix.length - a.prefix.length);
}

/**
 * [file] の実際の `paths`（と書いた tsconfig のディレクトリ）と `baseUrl`（書いた tsconfig から解決した絶対パス）。
 * 後の `extends` ほど、子ほど優先する。
 */
function readOptions(file, seen) {
    let options = {paths: null, pathsDir: null, baseUrl: null};
    if (seen.has(file) || seen.size > 10) return options;
    seen.add(file);
    let json;
    try {
        json = parseJsonc(fs.readFileSync(file, "utf8"));
    } catch {
        return options;
    }
    if (!json || typeof json !== "object") return options;
    const dir = path.dirname(file);

    for (const parent of [json.extends].flat()) {
        if (typeof parent !== "string" || !/^\.\.?[\\/]/.test(parent)) continue;
        const inherited = readOptions(path.resolve(dir, parent.endsWith(".json") ? parent : `${parent}.json`), seen);
        if (inherited.paths) options = {...options, paths: inherited.paths, pathsDir: inherited.pathsDir};
        if (inherited.baseUrl) options = {...options, baseUrl: inherited.baseUrl};
    }

    const {paths, baseUrl} = json.compilerOptions ?? {};
    if (paths && typeof paths === "object") options = {...options, paths, pathsDir: dir};
    if (typeof baseUrl === "string") options = {...options, baseUrl: path.resolve(dir, baseUrl)};
    return options;
}

/** コメントと末尾のカンマを許す JSON（tsconfig.json）を読む。 */
function parseJsonc(text) {
    let output = "";
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            output += char;
            if (char === "\\") output += text[++i] ?? "";
            else if (char === '"') inString = false;
        } else if (char === '"') {
            inString = true;
            output += char;
        } else if (char === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            output += "\n";
        } else if (char === "/" && text[i + 1] === "*") {
            i += 2;
            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
            i++;
        } else {
            output += char;
        }
    }
    return JSON.parse(output.replace(/,(\s*[}\]])/g, "$1"));
}

/** [fromUri] の文書のディレクトリからの [file]。 */
function fromDocument(file, fromUri) {
    if (typeof fromUri !== "string" || !fromUri.startsWith("file:")) return null;
    try {
        return path.resolve(path.dirname(fileURLToPath(fromUri)), file);
    } catch {
        return null;
    }
}

/** UNC パス。アクセスするだけでネットワークに出るので扱わない。 */
function isUncLike(value) {
    return /^[\\/]{2}/.test(value);
}

function isAbsolute(value) {
    return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function fileExists(file) {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

/** シンボリックリンクを辿る回数の上限（循環するリンク対策）。 */
const MAX_LINK_HOPS = 40;

/**
 * [target] が、シンボリックリンクを解決した後も [root] の内側にある通常ファイルかどうか。
 * リンク先が UNC パスでもアクセスしないよう、`realpathSync` を使わず 1 要素ずつ辿る。
 */
function isFileInside(root, target) {
    if (!root || target === root || !isInside(root, target)) return false;
    try {
        const realRoot = fs.realpathSync(root);
        const pending = path.relative(root, target).split(/[\\/]+/).filter(Boolean);
        let current = realRoot;
        let hops = 0;
        while (pending.length) {
            const part = pending.shift();
            if (part === ".") continue;
            const next = part === ".." ? path.dirname(current) : path.join(current, part);
            if (!isInside(realRoot, next)) return false;
            if (!fs.lstatSync(next).isSymbolicLink()) {
                current = next;
                continue;
            }
            if (++hops > MAX_LINK_HOPS) return false;
            const link = fs.readlinkSync(next);
            if (isUncLike(link)) return false;
            const resolved = path.resolve(current, link);
            if (!isInside(realRoot, resolved)) return false;
            // リンク先もリンクを含みうるので、ルートから辿り直す
            pending.unshift(...path.relative(realRoot, resolved).split(path.sep).filter(Boolean));
            current = realRoot;
        }
        return current !== realRoot && fs.statSync(current).isFile();
    } catch {
        return false;
    }
}

/** [target] が [root] 自身か、その内側かどうか。 */
function isInside(root, target) {
    const inner = path.relative(root, target);
    return inner === "" || (inner !== ".." && !inner.startsWith(`..${path.sep}`) && !path.isAbsolute(inner));
}

/** サービスごとに共有する PartialResolver（tsconfig の読み込みを使い回す）。 */
const resolvers = new WeakMap();

function partialResolver(config, services) {
    let resolver = resolvers.get(services);
    if (!resolver) {
        resolver = new PartialResolver(config, services.Scanner);
        resolvers.set(services, resolver);
    }
    return resolver;
}

module.exports = {PartialResolver, partialResolver, parseJsonc, isFileInside};
