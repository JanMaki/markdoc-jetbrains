const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {Services} = require("@markdoc/language-server");
const {ProjectModuleLoader, resolveFile} = require("./module-loader");

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/** スキーマのファイルの更新時刻を確かめる間隔（ミリ秒）。 */
const CHECK_INTERVAL_MS = 1000;

/**
 * [file] の更新時刻。
 *
 * @param {string} file 絶対パス
 * @returns {number | null} 更新時刻（ミリ秒）。なければ `null`
 */
function mtimeOf(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
}

/**
 * スキーマの読み込み方。設定の `schema.type` ごとにサブクラスを [SOURCES] に登録する。
 */
class SchemaSource {
    /**
     * @param {object} config サーバーの設定エントリ（`root` と `schema` を使う）
     */
    constructor(config) {
        this.config = config;
        /** `schema.path` をプロジェクトルートから解決した絶対パス。 */
        this.path = path.resolve(config.root, config.schema.path);
    }

    /**
     * スキーマを読む。
     *
     * @returns {Promise<object | undefined>} スキーマ
     * @throws {Error} 読み込みに失敗した場合
     */
    async load() {
        throw new Error("Not implemented");
    }

    /**
     * スキーマを読み込んだファイルの絶対パス。定義ジャンプでスキーマのタグや `variables` を探すのに使う。
     *
     * @returns {string[]} ファイルの絶対パス
     */
    files() {
        return [this.path];
    }

    /**
     * 更新時刻を見て、変わったらスキーマを読み直すファイルとディレクトリ。
     * 1 つのファイルのスキーマは上流の Watcher が `schema.path` の変更で読み直すので、既定では何も見ない。
     *
     * @returns {string[]} 絶対パス
     */
    watched() {
        return [];
    }

    /**
     * [watched] の今の更新時刻を覚える。[changed] はこれと比べる。
     */
    remember() {
        this.mtimes = new Map(this.watched().map((file) => [file, mtimeOf(file)]));
    }

    /**
     * [remember] で覚えたときから、[watched] のどれかの更新時刻が変わったか（消えた・できたを含む）。
     *
     * @returns {boolean} 変わっていれば真。まだ覚えていなければ偽
     */
    changed() {
        if (!this.mtimes) return false;
        const watched = this.watched();
        if (watched.length !== this.mtimes.size) return true;
        return watched.some((file) => !this.mtimes.has(file) || this.mtimes.get(file) !== mtimeOf(file));
    }

    /**
     * タグの `render` に書かれたコンポーネントのファイル。
     *
     * @param {unknown} render タグの `render` の値
     * @returns {string | null} ファイルの絶対パス。分からなければ `null`
     */
    componentFile(render) {
        return null;
    }

    /**
     * 読み込みに失敗したときに利用者に見せるメッセージ。
     *
     * @param {unknown} error 読み込みで投げられた例外
     * @returns {string} メッセージ
     */
    describeError(error) {
        const file = this.path;
        const reason = error?.message ?? String(error);
        let message = `Markdoc: Failed to load the schema ${file}: ${reason}`;
        if (!fs.existsSync(file)) {
            message = `Markdoc: The schema ${file} does not exist. Check schema.path in the config file.`;
        } else if (TYPESCRIPT_EXTENSIONS.has(path.extname(file)) && !process.features?.typescript) {
            message += ` Node.js ${process.version} cannot load TypeScript files. Use Node.js 22.18, 23.6 or later,`
                + " or write the schema in JavaScript (for example markdoc.config.mjs).";
        } else if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") {
            message += " Install the project's dependencies (for example npm install) and restart the IDE.";
        }
        return message;
    }
}

/** `schema.type` が `"node"` のスキーマ。`require` で読み、`schema.property` があればそのプロパティを使う。 */
class NodeSchemaSource extends SchemaSource {
    /** `require` のキャッシュを消してから読む。 */
    async load() {
        delete require.cache[this.path];
        const value = require(this.path);
        const {property} = this.config.schema;
        return property ? value[property] : value;
    }
}

/**
 * ESM のスキーマ。`file://` の URL で `import` し（上流は絶対パスを渡すので Windows で読めない）、
 * `schema.property`（既定は `default`）の export を使う。
 */
class EsmSchemaSource extends SchemaSource {
    /** 読み直すたびに別の URL（クエリに時刻を付ける）で `import` する。 */
    async load() {
        const url = pathToFileURL(this.path);
        // 再読み込みで別のモジュールとして読ませる
        url.search = `t=${Date.now()}`;
        const value = await import(url.href);
        return value[this.config.schema.property ?? "default"];
    }
}

/**
 * `schema.type` が `"nextjs"` のスキーマ。`schema.path` をスキーマのディレクトリとして、`@markdoc/next.js` と同じく
 * `tags`・`nodes`・`functions`・`config` を読み、`{tags, nodes, functions, ...config}` にまとめる。
 *
 * 各ファイルは [ProjectModuleLoader] で読む。React と Next.js のパッケージはスタブにし、`@markdoc/next.js` の
 * ファイル（`@markdoc/next.js/tags` など）はこのローダーで読む。
 */
class DirectorySchemaSource extends SchemaSource {
    /** スキーマのディレクトリから読むモジュールの名前（読む順）。`config` は最後にまとめるので最後に読む。 */
    static ENTRIES = ["tags", "nodes", "functions", "config"];

    /** スタブにするパッケージ。 */
    static STUB_PACKAGES = ["react", "react-dom", "next"];

    /** [ProjectModuleLoader] で読むパッケージ。 */
    static INLINE_PACKAGES = ["@markdoc/next.js"];

    /**
     * @param {object} config サーバーの設定エントリ（`root` と `schema` を使う）
     */
    constructor(config) {
        super(config);
        /** 前回の読み込みで使ったローダー。読み込む前は `null`。 */
        this.loader = null;
    }

    /**
     * 読むたびにローダーを作り直し、各モジュールのファイル（`tags.ts`、`tags/index.ts` など）を読む。
     * ないモジュールは空のオブジェクトにする。
     *
     * @returns {Promise<object>} スキーマ
     * @throws {Error} ディレクトリがない場合と、モジュールのファイルを読めない場合（メッセージの先頭にファイルのパスを付ける）
     */
    async load() {
        if (!isDirectory(this.path)) throw new Error(`${this.path} is not a directory`);
        const loader = new ProjectModuleLoader({
            root: this.config.root,
            stubPackages: DirectorySchemaSource.STUB_PACKAGES,
            inlinePackages: DirectorySchemaSource.INLINE_PACKAGES,
        });
        this.loader = loader;
        const modules = {};
        for (const entry of DirectorySchemaSource.ENTRIES) {
            const file = resolveFile(path.join(this.path, entry));
            if (!file) {
                modules[entry] = {};
                continue;
            }
            try {
                modules[entry] = loader.require(file);
            } catch (error) {
                throw new Error(`${file}: ${error?.message ?? String(error)}`, {cause: error});
            }
        }
        return {
            tags: defaultObject(modules.tags),
            nodes: defaultObject(modules.nodes),
            functions: defaultObject(modules.functions),
            ...defaultObject(modules.config),
        };
    }

    /** 前回の読み込みで読もうとしたプロジェクトのファイル（パッケージのファイルは除く）。 */
    files() {
        return this.loader?.files() ?? [];
    }

    /**
     * スキーマのディレクトリ、その中の各モジュールのディレクトリ（`tags/` など）と、[files]。
     * 上流の Watcher は `schema.path` そのものしか見ないので、ここで見る。
     * ディレクトリは、中のファイルを足したり消したりすると更新時刻が変わる。
     */
    watched() {
        const directories = DirectorySchemaSource.ENTRIES.map((entry) => path.join(this.path, entry)).filter(isDirectory);
        return [this.path, ...directories, ...this.files()];
    }

    /** [ProjectModuleLoader.originOf] で、`render` の値を定義したファイルを返す。 */
    componentFile(render) {
        return this.loader?.originOf(render) ?? null;
    }

    /** ディレクトリがなければ `schema.path` を確かめるよう伝え、ほかは例外のメッセージを添える。 */
    describeError(error) {
        if (!isDirectory(this.path)) {
            return `Markdoc: The schema directory ${this.path} does not exist. Check schema.path in the config file.`;
        }
        return `Markdoc: Failed to load the schema in ${this.path}: ${error?.message ?? String(error)}`;
    }
}

/**
 * `@markdoc/next.js` の `defaultObject` と同じく、モジュールに `default` の export があればそれを、なければモジュールを返す。
 *
 * @param {unknown} module モジュールの `module.exports`
 * @returns {object} 使う値
 */
function defaultObject(module) {
    if (module && Object.prototype.hasOwnProperty.call(module, "default")) return module.default;
    return module || {};
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

/** `schema.type` の値ごとの読み込み方。ない値は [EsmSchemaSource] で読む（上流と同じ）。 */
const SOURCES = {node: NodeSchemaSource, esm: EsmSchemaSource, nextjs: DirectorySchemaSource};

/**
 * 設定の `schema.type` に合う読み込み方を作る。
 *
 * @param {object} config サーバーの設定エントリ（`schema.path` があること）
 * @returns {SchemaSource} 読み込み方
 */
function createSchemaSource(config) {
    const Source = Object.hasOwn(SOURCES, config.schema.type) ? SOURCES[config.schema.type] : EsmSchemaSource;
    return new Source(config);
}

/**
 * スキーマの読み込み。上流からの変更点：
 * - 読み込み方を `schema.type` ごとの [SchemaSource] に分ける（ESM は `file://` の URL で読む）
 * - 失敗したら理由を通知する（上流は握りつぶす）
 */
class MarkdocSchema extends Services.Schema {
    /**
     * @param {object} config サーバーの設定エントリ
     * @param {object} connection LSP の接続
     */
    constructor(config, connection) {
        super(config, connection);
        this.connection = connection;
        /** スキーマの読み込み方。`schema.path` がなければ `null`。 */
        this.source = config.schema?.path ? createSchemaSource(config) : null;
        /** 最後に更新時刻を確かめた時刻（ミリ秒）。 */
        this.checkedAt = 0;
        /** 読み直している間の Promise。読み直していなければ `null`。 */
        this.reloading = null;
    }

    /**
     * 文書 [uri] に使うスキーマ。設定の `schema.watch` が真なら、スキーマのファイルが変わっていれば読み直しを始める
     * （読み直しが終わるまでは前のスキーマを返す）。
     *
     * @param {string} uri 文書の URI
     * @returns {object | undefined} スキーマ
     */
    get(uri) {
        this.reloadIfChanged();
        return super.get(uri);
    }

    /**
     * スキーマを読む。失敗したら理由を通知する。読んだ後に、読み込んだファイルの更新時刻を覚える。
     *
     * @returns {Promise<object | undefined>} スキーマ。`schema.path` がないか、読めなければ `undefined`
     */
    async load() {
        if (!this.source) return;
        try {
            const schema = await this.source.load();
            this.warnFailures();
            return schema;
        } catch (error) {
            this.report(error);
        } finally {
            this.source.remember();
        }
    }

    /**
     * 設定の `schema.watch` が真で、前に確かめてから [CHECK_INTERVAL_MS] 以上経っていれば、
     * スキーマのファイルの更新時刻を確かめ、変わっていれば読み直しを始める。
     */
    reloadIfChanged() {
        if (!this.source || !this.config.schema.watch || this.reloading) return;
        const now = Date.now();
        if (now - this.checkedAt < CHECK_INTERVAL_MS) return;
        this.checkedAt = now;
        if (!this.source.changed()) return;
        this.reloading = this.reload().finally(() => {
            this.reloading = null;
        });
    }

    /**
     * スキーマの読み込み中に、読めずにスタブに替えたファイルやパッケージを、理由とともに警告する。
     */
    warnFailures() {
        for (const {source, message} of this.source.loader?.failures ?? []) {
            this.connection?.console.warn(`Markdoc: Replaced ${source} with a stub because it failed to load: ${message}`);
        }
    }

    /**
     * 読めなかった理由を通知する。
     *
     * @param {unknown} error 読み込みで投げられた例外
     */
    report(error) {
        const message = this.source.describeError(error);
        this.connection?.console.error(message);
        this.connection?.window.showErrorMessage(message);
    }
}

module.exports = {
    MarkdocSchema,
    SchemaSource,
    NodeSchemaSource,
    EsmSchemaSource,
    DirectorySchemaSource,
    SOURCES,
    createSchemaSource,
    defaultObject,
};
