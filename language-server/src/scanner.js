const fs = require("node:fs/promises");
const path = require("node:path");
const {Services} = require("@markdoc/language-server");
const {patchCommentRules} = require("./comments");

/** スキャンしないディレクトリの名前。 */
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

/**
 * 上流の Scanner からの変更点：
 * - パスの表記を vscode-uri の `fsPath` に合わせる。上流は Windows で次の 2 点が食い違い、partial が見つからないという
 *   エラーになる
 *   - 基準パスは `root` から作るためドライブ文字が大文字（`D:\`）だが、検証時に `fsPath` から得るパスは
 *     小文字（`d:\`）になり、前方一致で比較すると現在のファイルが見つからない
 *   - ファイルを OS ネイティブの相対パス（`partials\footer.mdoc`）で登録する一方、partial の照合には
 *     タグに書かれた `/` 区切りの値（`partials/footer.mdoc`）を使う
 * - 登録キーは、基準パスの中のファイルなら基準パスからの `/` 区切りの相対パス、外なら絶対パスにする。上流は文字列の
 *   前方一致で比べるため、基準パスが `docs` のとき `docs-extra` の中のファイルを `extra/…` として登録してしまう
 * - 設定の `contentPaths` があれば、`path` の代わりにその各ディレクトリ（プロジェクトルートからのパス）をスキャンする
 * - `node_modules`・`.next`・`.git` のディレクトリはスキャンしない
 * - 設定の `markdocExtensions` の拡張子のファイルも読む
 */
class FsPathScanner extends Services.Scanner {
    /**
     * 基準パスのドライブ文字を `fsPath` と同じ小文字にそろえ、スキャンするディレクトリを決める。
     *
     * @param {object} config サーバーの設定エントリ
     */
    constructor(config) {
        super(config);
        this.path = lowerDriveLetter(this.path);
        /** スキャンするディレクトリの絶対パス。 */
        this.roots = scanRoots(config, this.path);
        this.extensions = [...new Set([...this.extensions, ...markdocExtensions(config)])];
        // TODO: Markdoc を更新して comments.js を消すときに、この呼び出しも消す
        patchCommentRules(this.tokenizer);
    }

    /**
     * 基準パスからの相対パスを、タグに書かれる値と同じ `/` 区切りで返す。
     *
     * @param {string} file ファイルの絶対パスか、登録キーの相対パス
     * @returns {string} 基準パスからの相対パス。相対パスか、基準パスの外なら [file] のまま
     */
    relativePath(file) {
        // 登録キー（相対パス）はそのまま返す
        if (!path.isAbsolute(file)) return file;
        // 文字列の前方一致ではなく区切りの境界で比べる（`docs` と `docs-extra` を取り違えない）
        const relative = path.relative(this.path, file);
        if (!relative || !isInside(relative)) return file;
        // POSIX ではもともと `/` 区切りなので変換しない
        return path.sep === "/" ? relative : relative.split(path.sep).join("/");
    }

    /**
     * 登録キー [file] のファイルの絶対パス。[relativePath] の逆にする。
     *
     * @param {string} file 基準パスからの相対パスか絶対パス
     * @returns {string} 絶対パス
     */
    fullPath(file) {
        return path.isAbsolute(file) ? file : path.join(this.path, file);
    }

    /**
     * スキャンするディレクトリから、Markdoc の拡張子のファイルを読む。
     *
     * @returns {Promise<void>} すべて読み終えたら解決する
     */
    async scan() {
        const promises = [];
        for (const root of this.roots) {
            for await (const file of findFiles(root, this.extensions)) promises.push(this.update(file));
        }
        await Promise.allSettled(promises);
    }

    /**
     * [file] がスキャンの対象（スキャンするディレクトリの中で、スキャンしないディレクトリの外にある Markdoc ファイル）か。
     *
     * @param {string} file ファイルの絶対パス
     * @returns {boolean} 対象なら真
     */
    matches(file) {
        return this.extensions.includes(path.extname(file)) && this.includes(file);
    }

    /**
     * [file] を読み直す。スキャンの対象の外なら何もしない（上流の Watcher はプロジェクトルートの下の変更をすべて送りうる）。
     *
     * @param {string} file ファイルの絶対パス
     * @returns {Promise<void>} 読み終えたら解決する
     */
    async update(file) {
        if (!this.includes(file)) return;
        return super.update(file);
    }

    /** [file] がスキャンするディレクトリのどれかの中にあり、途中にスキャンしないディレクトリがないか。 */
    includes(file) {
        return this.roots.some((root) => {
            const relative = path.relative(root, file);
            if (!relative || !isInside(relative)) return false;
            return !relative.split(path.sep).slice(0, -1).some((name) => SKIPPED_DIRECTORIES.has(name));
        });
    }
}

/**
 * `path.relative` の結果 [relative] が、基準のディレクトリの中（基準そのものを含む）を指すか。
 *
 * @param {string} relative 基準のディレクトリからの相対パス
 * @returns {boolean} 中なら真
 */
function isInside(relative) {
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * スキャンするディレクトリ。設定の `contentPaths` が空でない文字列の配列なら、そのうちプロジェクトルートの中のもの
 * （`""` はプロジェクトルート）。なければ [base]。
 *
 * @param {object} config サーバーの設定エントリ
 * @param {string} base 上流が `root` と `path` から作った基準パス
 * @returns {string[]} 絶対パス
 */
function scanRoots(config, base) {
    const {contentPaths, root} = config;
    if (!Array.isArray(contentPaths)) return [base];
    const rootPath = lowerDriveLetter(path.resolve(root));
    const roots = contentPaths
        .filter((entry) => typeof entry === "string")
        .map((entry) => path.resolve(rootPath, entry))
        .filter((dir) => isInside(path.relative(rootPath, dir)));
    return roots.length ? roots : [base];
}

/**
 * [dir] の下の、[extensions] の拡張子のファイル。上流と同じくシンボリックリンクの先もたどる。
 * スキャンしないディレクトリには入らない。読めないディレクトリとファイルは飛ばす。
 *
 * @param {string} dir ディレクトリの絶対パス
 * @param {string[]} extensions 拡張子（`.md` など）
 * @returns {AsyncGenerator<string>} ファイルの絶対パス
 */
async function* findFiles(dir, extensions) {
    let names;
    try {
        names = await fs.readdir(dir);
    } catch {
        return;
    }
    for (const name of names) {
        const file = path.join(dir, name);
        let info;
        try {
            info = await fs.stat(file);
        } catch {
            continue;
        }
        if (info.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(name)) yield* findFiles(file, extensions);
        } else if (extensions.includes(path.extname(name))) {
            yield file;
        }
    }
}

/**
 * 設定の `markdocExtensions` の拡張子。Kotlin 側の MarkdocFileScope と同じく、小文字にし、先頭に `.` がなければ付ける。
 *
 * @param {object} config サーバーの設定エントリ
 * @returns {string[]} 拡張子（`.md` など）
 */
function markdocExtensions(config) {
    if (!Array.isArray(config.markdocExtensions)) return [];
    return config.markdocExtensions
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry && entry !== ".")
        .map((entry) => entry.startsWith(".") ? entry : `.${entry}`);
}

/** vscode-uri の `fsPath` と同じく、Windows のドライブ文字を小文字にする。 */
function lowerDriveLetter(fsPath) {
    return /^[A-Z]:/.test(fsPath) ? fsPath[0].toLowerCase() + fsPath.slice(1) : fsPath;
}

module.exports = {FsPathScanner, SKIPPED_DIRECTORIES, findFiles, scanRoots};
