const fs = require("node:fs");
const path = require("node:path");
const {fileURLToPath} = require("node:url");

/**
 * partial の `file` をファイルに解決する規則。設定の `partialPaths` ごとにサブクラスを [PARTIAL_RULES] に登録する。
 *
 * 規則ごとの境界（[boundary]）の外のファイルは返さない。
 */
class PartialRule {
    /**
     * @param {object} config サーバーの設定エントリ
     * @param {object} Scanner 上流の Scanner（`path` にコンテンツのディレクトリの絶対パスを持つ）
     */
    constructor(config, Scanner) {
        this.config = config;
        this.Scanner = Scanner;
    }

    /**
     * [fromUri] の文書に書かれた [file] の絶対パス。
     *
     * @param {unknown} file partial の `file` 属性の値
     * @param {string} fromUri partial を書いた文書の URI
     * @returns {string | null} 絶対パス。解決できないか、境界の外なら `null`
     */
    resolve(file, fromUri) {
        if (typeof file !== "string" || !file || isUncLike(file)) return null;
        const target = this.target(file, fromUri);
        return target && isFileInside(this.boundary(), target) ? target : null;
    }

    /**
     * 境界の検査の前の、[file] の絶対パス。
     *
     * @param {string} file partial の `file` 属性の値（空でない）
     * @param {string} fromUri partial を書いた文書の URI
     * @returns {string | null} 絶対パス。解決できなければ `null`
     */
    target(file, fromUri) {
        throw new Error("Not implemented");
    }

    /**
     * 解決したファイルが内側になければならないディレクトリ。
     *
     * @returns {string} 絶対パス
     */
    boundary() {
        throw new Error("Not implemented");
    }
}

/** `"content"`（既定）：コンテンツのディレクトリ（`path`）から解決する。上流と同じ。境界はコンテンツのディレクトリ。 */
class ContentPartialRule extends PartialRule {
    /** 先頭の `/` を除き、コンテンツのディレクトリからのパスにする。 */
    target(file) {
        const relative = file.replace(/^[\\/]/, "");
        return relative && !isAbsolute(relative) ? path.join(this.Scanner.path, relative) : null;
    }

    /** コンテンツのディレクトリを返す。 */
    boundary() {
        return this.Scanner.path;
    }
}

/**
 * `"relative"`：Astro と同じ。`./`・`../` とそれ以外の名前は書いたファイルから、`/` はプロジェクトルートから、
 * tsconfig の `paths` の別名はその行き先から解決する。境界はプロジェクトルート。
 */
class RelativePartialRule extends PartialRule {
    /**
     * @param {object} config サーバーの設定エントリ
     * @param {object} Scanner 上流の Scanner
     */
    constructor(config, Scanner) {
        super(config, Scanner);
        /** プロジェクトルートの tsconfig.json の別名。 */
        this.aliases = new TsconfigAliases(config.root);
    }

    /** 書き方（`./`・`../`、`/`、別名、そのほか）ごとの基準から解決する。 */
    target(file, fromUri) {
        if (/^\.\.?([\\/]|$)/.test(file)) return fromDocument(file, fromUri);
        if (/^[\\/]/.test(file)) return path.join(this.config.root, file.slice(1));
        if (isAbsolute(file)) return null;
        // Vite と同じく、別名の行き先のうち最初に存在するもの
        const alias = this.aliases.match(file).find(fileExists);
        return alias ?? fromDocument(file, fromUri);
    }

    /** プロジェクトルートを返す。 */
    boundary() {
        return this.config.root;
    }
}

/**
 * `{"directory": "…"}`：指定したディレクトリ（プロジェクトルートからのパス）から解決する。`@markdoc/next.js` と同じく、
 * 先頭の `/` もそのディレクトリからとし、`../` で外に出ることも許す。境界はプロジェクトルート。
 */
class DirectoryPartialRule extends PartialRule {
    /**
     * @param {object} config サーバーの設定エントリ（`partialPaths.directory` が文字列であること）
     * @param {object} Scanner 上流の Scanner
     */
    constructor(config, Scanner) {
        super(config, Scanner);
        // Kotlin 側の findUnder と同じく、区切りを `/` にそろえて前後の `/` を除き、POSIX でもプロジェクトルートからのパスにする
        const relative = config.partialPaths.directory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        /** partial を探すディレクトリの絶対パス。 */
        this.directory = path.resolve(config.root, relative);
    }

    /** 先頭の `/` を除き、指定したディレクトリからのパスにする。 */
    target(file) {
        const relative = file.replace(/^[\\/]/, "");
        return relative && !isAbsolute(relative) ? path.join(this.directory, relative) : null;
    }

    /** プロジェクトルートを返す。 */
    boundary() {
        return this.config.root;
    }
}

/** 文字列の `partialPaths` の値ごとの規則。 */
const PARTIAL_RULES = {content: ContentPartialRule, relative: RelativePartialRule};

/**
 * 設定の `partialPaths` に合う規則を作る。文字列なら [PARTIAL_RULES] から選び、`directory` が文字列のオブジェクトなら
 * [DirectoryPartialRule]、どちらでもなければ [ContentPartialRule] にする。
 *
 * @param {object} config サーバーの設定エントリ
 * @param {object} Scanner 上流の Scanner
 * @returns {PartialRule} 規則
 */
function createPartialRule(config, Scanner) {
    const value = config.partialPaths;
    let Rule = ContentPartialRule;
    if (typeof value === "string" && Object.hasOwn(PARTIAL_RULES, value)) Rule = PARTIAL_RULES[value];
    else if (value && typeof value === "object" && typeof value.directory === "string") Rule = DirectoryPartialRule;
    return new Rule(config, Scanner);
}

/**
 * tsconfig.json の `compilerOptions.paths` の別名。`extends` で読んだファイルを含め、
 * どれかの更新時刻が変わったときだけ読み直す。
 */
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
        if (mtimeOf(file) === null) return [];
        const unchanged = (mtimes) => [...mtimes].every(([dependency, mtime]) => mtimeOf(dependency) === mtime);
        if (this.cache && unchanged(this.cache.mtimes)) return this.cache.entries;
        // 読んでいる間に変わったファイルがあれば読み直す
        for (let attempt = 0; attempt < 3; attempt++) {
            // 読んだ（読もうとした）ファイルの、読む前の更新時刻。次回これと比べる
            const mtimes = new Map();
            const entries = readAliases(file, mtimes);
            this.cache = {entries, mtimes};
            if (unchanged(mtimes)) break;
        }
        return this.cache.entries;
    }
}

/** [file] の更新時刻。なければ `null`。 */
function mtimeOf(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
}

/**
 * [file] の別名。`extends` は相対パスのものだけたどり、`paths` と `baseUrl` はそれぞれ子が親を上書きする。
 * 行き先は実際の（継承したものを含む）`baseUrl` から、なければ `paths` を書いた tsconfig のディレクトリから解決する
 * （TypeScript 4.1 以降）。`*` の前が長い（具体的な）別名から並べる（TypeScript と同じ優先順）。
 * [mtimes] に、読んだファイルと読む前の更新時刻を加える。
 */
function readAliases(file, mtimes) {
    const {paths, pathsDir, baseUrl} = readOptions(file, mtimes, new Set(), new Map());
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
 * 後の `extends` ほど、子ほど優先する。[active] は読んでいる途中のファイル（循環の検出）。
 * [parsed] は読んだファイルの解析結果（読めなければ `null`）。
 */
function readOptions(file, mtimes, active, parsed) {
    let options = {paths: null, pathsDir: null, baseUrl: null};
    if (active.has(file) || active.size > 10) return options;
    if (!parsed.has(file)) {
        mtimes.set(file, mtimeOf(file));
        parsed.set(file, readJsonc(file));
    }
    const json = parsed.get(file);
    if (!json || typeof json !== "object") return options;
    const dir = path.dirname(file);

    active.add(file);
    for (const parent of [json.extends].flat()) {
        if (typeof parent !== "string" || !/^\.\.?[\\/]/.test(parent)) continue;
        const target = path.resolve(dir, parent.endsWith(".json") ? parent : `${parent}.json`);
        const inherited = readOptions(target, mtimes, active, parsed);
        if (inherited.paths) options = {...options, paths: inherited.paths, pathsDir: inherited.pathsDir};
        if (inherited.baseUrl) options = {...options, baseUrl: inherited.baseUrl};
    }
    active.delete(file);

    const {paths, baseUrl} = json.compilerOptions ?? {};
    if (paths && typeof paths === "object") options = {...options, paths, pathsDir: dir};
    if (typeof baseUrl === "string") options = {...options, baseUrl: path.resolve(dir, baseUrl)};
    return options;
}

/** [file] を JSONC として読む。読めなければ `null`。 */
function readJsonc(file) {
    try {
        return parseJsonc(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
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
        // ネイティブの区切りで分ける（POSIX ではファイル名のバックスラッシュも名前の一部として扱う）
        const pending = path.relative(root, target).split(path.sep).filter(Boolean);
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

/** サービスごとに共有する PartialRule（tsconfig の読み込みを使い回す）。 */
const resolvers = new WeakMap();

/**
 * [services] で共有する、設定の `partialPaths` に合う規則。
 *
 * @param {object} config サーバーの設定エントリ
 * @param {object} services 上流のサービス（`Scanner` を使う）
 * @returns {PartialRule} 規則
 */
function partialResolver(config, services) {
    let resolver = resolvers.get(services);
    if (!resolver) {
        resolver = createPartialRule(config, services.Scanner);
        resolvers.set(services, resolver);
    }
    return resolver;
}

module.exports = {
    PartialRule,
    ContentPartialRule,
    RelativePartialRule,
    DirectoryPartialRule,
    PARTIAL_RULES,
    TsconfigAliases,
    createPartialRule,
    partialResolver,
    parseJsonc,
    isFileInside,
};
