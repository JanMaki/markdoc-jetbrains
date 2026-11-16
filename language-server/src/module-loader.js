const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {builtinModules, createRequire} = require("node:module");
const {transform} = require("sucrase");
const {TsconfigAliases} = require("./partials");

/** 拡張子を省いた import に補う拡張子（書いた順に探す）。 */
const RESOLVE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];

/** TypeScript の書き方で `.js` などと書いた import を、TypeScript のファイルに読み替える拡張子。 */
const TYPESCRIPT_REPLACEMENTS = {".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"]};

/** 実行せずにスタブにするファイルの拡張子。 */
const ASSET_EXTENSIONS = new Set([
    ".css", ".scss", ".sass", ".less", ".styl", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
    ".bmp", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".mp3", ".wav", ".pdf", ".md", ".mdoc", ".mdx",
]);

/** 拡張子ごとの sucrase の変換。 */
const TRANSFORMS = {
    ".ts": ["typescript", "imports"],
    ".mts": ["typescript", "imports"],
    ".cts": ["typescript", "imports"],
    ".tsx": ["typescript", "jsx", "imports"],
};

/** TypeScript 以外のファイルの変換。`.js` にも JSX が書かれうる。 */
const JAVASCRIPT_TRANSFORMS = ["jsx", "imports"];

/** Node の組み込みモジュールの名前。 */
const BUILTIN_MODULES = new Set(builtinModules);

/** 変換したコードを包む関数の引数（CommonJS のモジュールと同じ）。 */
const PARAMETERS = ["exports", "require", "module", "__filename", "__dirname"];

/** スタブが持つ、読み込み元（ファイルの絶対パスかパッケージ名）のキー。 */
const STUB_SOURCE = Symbol("markdocStubSource");

/**
 * 読み込み元 [source] のスタブ。呼んでも、`new` しても、プロパティを読んでも自身を返す。
 *
 * @param {string} source 読み込み元のファイルの絶対パスかパッケージ名
 * @returns {Function} スタブ
 */
function createStub(source) {
    const stub = new Proxy(function () {
    }, {
        get(target, key) {
            if (key === STUB_SOURCE) return source;
            // Promise とみなされないようにする
            if (key === "then") return undefined;
            if (key === "__esModule") return true;
            if (key === Symbol.toPrimitive) return () => `[stub ${source}]`;
            if (key === Symbol.iterator) return function* () {
            };
            if (typeof key === "symbol") return undefined;
            return stub;
        },
        apply() {
            return stub;
        },
        construct() {
            return stub;
        },
    });
    return stub;
}

/**
 * [value] がスタブなら、その読み込み元。
 *
 * @param {unknown} value 調べる値
 * @returns {string | null} 読み込み元のファイルの絶対パスかパッケージ名。スタブでなければ `null`
 */
function stubSource(value) {
    if (typeof value !== "function") return null;
    const source = value[STUB_SOURCE];
    return typeof source === "string" ? source : null;
}

/**
 * プロジェクトの JavaScript・TypeScript を、ビルドせずに Node で読む。
 *
 * ファイルは sucrase で TypeScript・JSX・import を CommonJS に変換して `vm` で実行する。読み込んだモジュールは
 * このローダーの中でだけ覚え、Node の `require` のキャッシュには入れない。
 *
 * - 相対パスと tsconfig の `paths` の別名は、拡張子と `index.*` を補ってプロジェクトのファイルに解決する
 * - [stubPackages] のパッケージと、画像やスタイルシートなどのファイルはスタブにする
 * - [inlinePackages] のパッケージは、パッケージのファイルもこのローダーで読む（中の import にも上の規則が働く）
 * - ほかのパッケージは、読み込むファイルから Node の `require` で読む
 * - 最初に読むファイル（[require] に渡したファイル）以外は、読み込みに失敗するとスタブに替えて続ける
 */
class ProjectModuleLoader {
    /**
     * @param {object} options 読み込みの設定
     * @param {string} options.root プロジェクトルートの絶対パス（tsconfig.json を探す）
     * @param {string[]} [options.stubPackages] スタブにするパッケージ。`name` はそのパッケージと `name/…` に当てはまる
     * @param {string[]} [options.inlinePackages] このローダーで読むパッケージ。当てはめ方は [stubPackages] と同じ
     */
    constructor({root, stubPackages = [], inlinePackages = []}) {
        this.root = root;
        this.stubPackages = stubPackages;
        this.inlinePackages = inlinePackages;
        this.aliases = new TsconfigAliases(root);
        /** 読み込み中か読み込み済みのファイルの絶対パスと、そのモジュール。読み込みに失敗したファイルは除く。 */
        this.modules = new Map();
        /** 読み込もうとしたファイルの絶対パス（失敗したものを含む）。読み込みを始めた順に並ぶ。 */
        this.attempted = new Set();
        /** export された値と、それを最初に export したファイルの絶対パス。 */
        this.origins = new WeakMap();
        /** 読み込みに失敗してスタブに替えたファイルやパッケージと、その理由。 */
        this.failures = [];
    }

    /**
     * [file] を読み、その `module.exports` を返す。
     *
     * @param {string} file 読むファイルの絶対パス
     * @returns {unknown} `module.exports`
     * @throws {Error} [file] を読めない、変換できない、実行中に例外が起きた場合
     */
    require(file) {
        return this.loadFile(file);
    }

    /**
     * 読み込もうとしたファイル（失敗したものを含む）の絶対パス。パッケージのファイルは含めない。
     *
     * @returns {string[]} 読み込みを始めた順のファイル
     */
    files() {
        return [...this.attempted].filter((file) => !isInNodeModules(file));
    }

    /**
     * [value] を定義したファイル。スタブならその読み込み元のファイル、ほかは最初に export したファイル。
     *
     * @param {unknown} value 調べる値（タグの `render` など）
     * @returns {string | null} ファイルの絶対パス。分からないか、パッケージのスタブなら `null`
     */
    originOf(value) {
        const source = stubSource(value);
        if (source) return path.isAbsolute(source) ? source : null;
        if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
        return this.origins.get(value) ?? null;
    }

    /**
     * [file] を変換して実行する。読み込み中か読み込み済みなら、そのモジュールを使う。
     * 失敗したらモジュールを捨てる（次に同じファイルを読むときは読み直す）。
     *
     * @param {string} file 読むファイルの絶対パス
     * @returns {unknown} `module.exports`
     * @throws {Error} 読めない、変換できない、実行中に例外が起きた場合
     */
    loadFile(file) {
        const loaded = this.modules.get(file);
        if (loaded) return loaded.exports;
        const module = {exports: {}};
        this.modules.set(file, module);
        this.attempted.add(file);
        try {
            const source = fs.readFileSync(file, "utf8");
            if (path.extname(file).toLowerCase() === ".json") {
                module.exports = JSON.parse(source);
            } else {
                const wrapper = vm.compileFunction(compile(source, file), PARAMETERS, {filename: file});
                const require = (specifier) => this.requireFrom(file, specifier);
                wrapper.call(module.exports, module.exports, require, module, file, path.dirname(file));
            }
        } catch (error) {
            this.modules.delete(file);
            throw error;
        }
        this.recordOrigins(module.exports, file);
        return module.exports;
    }

    /**
     * [from] のファイルに書かれた `require(specifier)` の値。失敗したらスタブを返す。
     *
     * @param {string} from `require` を書いたファイルの絶対パス
     * @param {unknown} specifier `require` に渡された値
     * @returns {unknown} モジュールの `module.exports` かスタブ
     */
    requireFrom(from, specifier) {
        if (typeof specifier !== "string") return createStub(String(specifier));
        if (specifier.startsWith("node:") || BUILTIN_MODULES.has(specifier)) return require(specifier);
        if (isAsset(specifier)) return createStub(this.assetSource(from, specifier));
        const file = this.resolveProjectFile(from, specifier);
        if (file) return this.guard(file, () => isAsset(file) ? createStub(file) : this.loadFile(file));
        if (isRelativeOrAbsolute(specifier)) return this.fail(specifier, new Error(`Cannot find ${specifier} from ${from}`));
        if (matchesPackage(this.stubPackages, specifier)) return createStub(specifier);
        if (matchesPackage(this.inlinePackages, specifier)) {
            return this.guard(specifier, () => this.loadFile(createRequire(from).resolve(specifier)));
        }
        return this.guard(specifier, () => createRequire(from)(specifier));
    }

    /**
     * [load] の値。例外が起きたら失敗を記録し、[source] のスタブにする。
     *
     * @param {string} source 読み込むファイルの絶対パスかパッケージ名
     * @param {() => unknown} load 読み込む関数
     * @returns {unknown} [load] の値かスタブ
     */
    guard(source, load) {
        try {
            return load();
        } catch (error) {
            return this.fail(source, error);
        }
    }

    /**
     * [source] の読み込みの失敗を [failures] に記録し、スタブを返す。
     *
     * @param {string} source 読み込もうとしたファイルの絶対パスかパッケージ名
     * @param {unknown} error 読み込みで投げられた例外
     * @returns {Function} [source] のスタブ
     */
    fail(source, error) {
        this.failures.push({source, message: error?.message ?? String(error)});
        return createStub(source);
    }

    /**
     * 画像などの [specifier] のスタブの読み込み元。
     *
     * @param {string} from `require` を書いたファイルの絶対パス
     * @param {string} specifier `require` に渡された値
     * @returns {string} 相対パスか絶対パスなら [from] から解決した絶対パス、ほかは [specifier] のまま
     */
    assetSource(from, specifier) {
        return isRelativeOrAbsolute(specifier) ? path.resolve(path.dirname(from), specifier) : specifier;
    }

    /**
     * [from] のファイルに書かれた [specifier] が指すプロジェクトのファイル。
     * 相対パス、絶対パス、tsconfig の `paths` の別名を解決する。
     *
     * @param {string} from `require` を書いたファイルの絶対パス
     * @param {string} specifier `require` に渡された値
     * @returns {string | null} ファイルの絶対パス。パッケージの指定か、見つからなければ `null`
     */
    resolveProjectFile(from, specifier) {
        if (isRelativeOrAbsolute(specifier)) return resolveFile(path.resolve(path.dirname(from), specifier));
        for (const target of this.aliases.match(specifier)) {
            const file = resolveFile(target);
            if (file) return file;
        }
        return null;
    }

    /**
     * [exports] とその各プロパティの値（オブジェクトと関数）を、まだ記録がなければ [file] が定義したものとして記録する。
     *
     * @param {unknown} exports [file] の `module.exports`
     * @param {string} file 読み込んだファイルの絶対パス
     */
    recordOrigins(exports, file) {
        const values = [exports];
        if (exports && typeof exports === "object") {
            for (const key of Object.keys(exports)) values.push(exports[key]);
            if (Object.hasOwn(exports, "default")) values.push(exports.default);
        }
        for (const value of values) {
            if ((typeof value !== "object" && typeof value !== "function") || value === null) continue;
            if (stubSource(value) || this.origins.has(value)) continue;
            this.origins.set(value, file);
        }
    }
}

/**
 * [source] を [file] の拡張子に合わせて CommonJS に変換する。JSX は `react/jsx-runtime` を使う形にする。
 *
 * @param {string} source ファイルの中身
 * @param {string} file ファイルの絶対パス
 * @returns {string} 変換したコード
 * @throws {Error} 構文が読めない場合
 */
function compile(source, file) {
    const extension = path.extname(file).toLowerCase();
    return transform(source, {
        transforms: TRANSFORMS[extension] ?? JAVASCRIPT_TRANSFORMS,
        filePath: file,
        jsxRuntime: "automatic",
        production: true,
        disableESTransforms: true,
    }).code;
}

/**
 * [base] に当たるファイル。そのまま、拡張子を補ったもの、TypeScript のファイルに読み替えたもの、ディレクトリの `index.*` の順に探す。
 *
 * @param {string} base 拡張子を省いたかもしれない絶対パス
 * @returns {string | null} ファイルの絶対パス。なければ `null`
 */
function resolveFile(base) {
    if (isFile(base)) return base;
    for (const extension of RESOLVE_EXTENSIONS) {
        if (isFile(base + extension)) return base + extension;
    }
    const written = path.extname(base);
    for (const extension of TYPESCRIPT_REPLACEMENTS[written] ?? []) {
        const replaced = base.slice(0, -written.length) + extension;
        if (isFile(replaced)) return replaced;
    }
    if (isDirectory(base)) {
        for (const extension of RESOLVE_EXTENSIONS) {
            const index = path.join(base, `index${extension}`);
            if (isFile(index)) return index;
        }
    }
    return null;
}

/**
 * [specifier] が [packages] のどれか（そのパッケージか、その下のパス）に当てはまるか。
 *
 * @param {string[]} packages パッケージ名
 * @param {string} specifier `require` に渡された値
 * @returns {boolean} 当てはまれば真
 */
function matchesPackage(packages, specifier) {
    return packages.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/**
 * [specifier] が `./`・`../` で始まる指定か、絶対パスか。
 *
 * @param {string} specifier `require` に渡された値
 * @returns {boolean} そうなら真
 */
function isRelativeOrAbsolute(specifier) {
    return /^\.\.?([\\/]|$)/.test(specifier) || path.isAbsolute(specifier);
}

/**
 * [specifier] が、実行せずにスタブにするファイルの指定か。クエリ（`?raw` など）を除いて拡張子を見る。
 *
 * @param {string} specifier `require` に渡された値か、ファイルの絶対パス
 * @returns {boolean} そうなら真
 */
function isAsset(specifier) {
    return ASSET_EXTENSIONS.has(path.extname(specifier.replace(/[?#].*$/, "")).toLowerCase());
}

/**
 * [file] が `node_modules` の中か。
 *
 * @param {string} file ファイルの絶対パス
 * @returns {boolean} 中なら真
 */
function isInNodeModules(file) {
    return file.split(/[\\/]/).includes("node_modules");
}

/**
 * [file] がファイルか。
 *
 * @param {string} file 絶対パス
 * @returns {boolean} ファイルなら真。なければ偽
 */
function isFile(file) {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

/**
 * [file] がディレクトリか。
 *
 * @param {string} file 絶対パス
 * @returns {boolean} ディレクトリなら真。なければ偽
 */
function isDirectory(file) {
    try {
        return fs.statSync(file).isDirectory();
    } catch {
        return false;
    }
}

module.exports = {ProjectModuleLoader, createStub, stubSource, resolveFile, RESOLVE_EXTENSIONS};
