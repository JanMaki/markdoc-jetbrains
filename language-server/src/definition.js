const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {Plugins} = require("@markdoc/language-server");
const {isFileInside, partialResolver} = require("./partials");
const {frontmatterVariableName} = require("./variables");

/** ファイルの先頭。 */
const FILE_START = {start: {line: 0, character: 0}, end: {line: 0, character: 0}};

/** タグ名（`{% aside`、`{% /aside`）。 */
const TAG_NAME = /\{%-?\s*\/?([A-Za-z_][\w-]*)/g;

/** 変数参照（`$a.b`、`$a["b"][0]`）。 */
const VARIABLE = /\$[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*|\[\s*(?:"(?:[^"\\]|\\.)*"|\d+)\s*\])*/g;

/** 変数参照の 1 階層（名前、数値の添字、文字列の添字）。 */
const SEGMENT = /\$?([A-Za-z_][\w-]*)|\[\s*(?:(\d+)|"((?:[^"\\]|\\.)*)")\s*\]/g;

/**
 * 定義ジャンプと参照。上流からの変更点：
 * - partial は [partialResolver] で解決し、参照は解決先が同じものを探す（上流は `file` の文字列で比べる）
 * - タグ名からは、タグを描画するコンポーネント（Astro の `component()`）へ移動する
 * - 変数からは、フロントマターのキーかスキーマの `variables` へ移動する
 *
 * 移動先は上流と同じくファイルパスで返す。
 */
class MarkdocDefinitionProvider extends Plugins.DefinitionProvider {
    onDefinition(params) {
        const line = this.lineAt(params);
        const component = line && this.componentAt(params, line);
        if (component) return {uri: component, range: FILE_START};
        const variable = line && this.variableAt(params, line);
        if (variable) return variable;

        const ast = this.services.Documents.ast(params.textDocument.uri);
        if (!ast) return null;
        const file = this.getPartialAtLine(ast, params.position.line);
        if (!file) return null;
        const target = partialResolver(this.config, this.services).resolve(file, params.textDocument.uri);
        return target ? {uri: target, range: FILE_START} : null;
    }

    onReferences(params) {
        const {uri} = params.textDocument;
        const ast = this.services.Documents.ast(uri);
        if (!ast) return null;
        const file = this.getPartialAtLine(ast, params.position.line);
        if (!file) return null;

        const resolver = partialResolver(this.config, this.services);
        const target = resolver.resolve(file, uri);
        if (!target) return null;

        const output = [];
        for (const [key, {partials}] of this.services.Scanner.entries()) {
            const full = this.services.Scanner.fullPath(key);
            const from = pathToFileURL(full).href;
            for (const partial of partials) {
                const value = partial.attributes?.file;
                if (typeof value !== "string" || !samePath(resolver.resolve(value, from), target)) continue;
                const [line = 0] = partial.lines ?? [];
                output.push({uri: full, range: {start: {line, character: 0}, end: {line, character: 0}}});
            }
        }
        return output;
    }

    /** カーソルの行のテキスト。文書がなければ `null`。 */
    lineAt(params) {
        const line = params.position.line;
        return this.services.Documents.get(params.textDocument.uri)
            ?.getText({start: {line, character: 0}, end: {line: line + 1, character: 0}}) ?? null;
    }

    /**
     * カーソルの下の変数の定義。フロントマターの変数なら文書のフロントマターのキー（トップレベル）、
     * スキーマの変数ならスキーマのファイルのキー。
     */
    variableAt(params, line) {
        const {uri} = params.textDocument;
        const keys = variablePathAt(line, params.position.character);
        if (!keys) return null;

        const name = frontmatterVariableName(this.config);
        let frontmatterKeys = null;
        if (keys[0] === "markdoc" && keys[1] === "frontmatter") frontmatterKeys = keys.slice(2);
        else if (name && keys[0] === name && !this.hasSchemaVariable(uri, name)) frontmatterKeys = keys.slice(1);
        if (frontmatterKeys) {
            const range = frontmatterKeyRange(this.services.Documents.get(uri).getText(), frontmatterKeys[0]);
            return range ? {uri, range} : null;
        }
        return this.schemaVariable(uri, keys);
    }

    /** スキーマの `variables` に [name] があるか。 */
    hasSchemaVariable(uri, name) {
        const variables = this.services.Schema.get(uri)?.variables;
        return Boolean(variables && typeof variables === "object" && name in variables);
    }

    /** スキーマのファイルで [keys] を文字列として探す（スキーマは JavaScript なので）。 */
    schemaVariable(uri, keys) {
        if (!this.hasSchemaVariable(uri, keys[0])) return null;
        const {schema, root} = this.config;
        if (!schema?.path || !root) return null;
        const absolute = path.resolve(root, schema.path);
        let source;
        try {
            source = fs.readFileSync(absolute, "utf8");
        } catch {
            return null;
        }
        const offset = findKeyPath(source, keys.filter((key) => typeof key === "string"));
        if (offset < 0) return null;
        const position = positionAt(source, offset);
        return {uri: absolute, range: {start: position, end: position}};
    }

    /** カーソルの下のタグを描画するコンポーネントのファイル。 */
    componentAt(params, line) {
        const name = tagNameAt(line, params.position.character);
        const render = name && this.services.Schema.get(params.textDocument.uri)?.tags?.[name]?.render;
        return resolveComponent(render, this.config.root);
    }
}

/** [character] の位置の変数参照の、カーソルの階層までのキー（`$a.b.c` の `b` の上なら `["a", "b"]`）。 */
function variablePathAt(text, character) {
    VARIABLE.lastIndex = 0;
    for (let match; (match = VARIABLE.exec(text));) {
        const start = match.index;
        const end = start + match[0].length;
        if (character < start || character > end) continue;
        const output = [];
        SEGMENT.lastIndex = 0;
        for (let segment; (segment = SEGMENT.exec(match[0]));) {
            const [, name, index, key] = segment;
            const value = name ?? (index !== undefined ? Number(index) : decodeKey(key));
            if (value === null) return null;
            output.push(value);
            if (start + segment.index + segment[0].length >= character) break;
        }
        return output.length ? output : null;
    }
    return null;
}

/** 添字の文字列の中身（エスケープを含む）。不正なエスケープ（`\q`）があれば `null`。 */
function decodeKey(key) {
    try {
        return JSON.parse(`"${key}"`);
    } catch {
        return null;
    }
}

/** フロントマターのトップレベルのキー [key] の範囲。見つからなければ `---` の行、フロントマターがなければ `null`。 */
function frontmatterKeyRange(text, key) {
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== "---") return null;
    const start = {start: {line: 0, character: 0}, end: {line: 0, character: 3}};
    if (typeof key !== "string") return start;
    for (let line = 1; line < lines.length && lines[line].trim() !== "---"; line++) {
        const match = /^(["']?)([^"':#][^"':]*?)\1\s*:/.exec(lines[line]);
        if (match && match[2] === key) {
            const character = match[1].length;
            return {start: {line, character}, end: {line, character: character + key.length}};
        }
    }
    return start;
}

/** [source] で `variables` の後に [keys]（`name:`、`"name":`）を順に探し、最後のキーの位置を返す。なければ -1。 */
function findKeyPath(source, keys) {
    let offset = source.search(/\bvariables\s*:/);
    if (offset < 0) return -1;
    for (const key of keys) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(?:^|[\\s{,])(["']?)${escaped}\\1\\s*:`, "g");
        pattern.lastIndex = offset;
        const match = pattern.exec(source);
        if (!match) return -1;
        offset = match.index + match[0].lastIndexOf(key);
    }
    return offset;
}

/** 文字の位置を LSP の行と列にする。 */
function positionAt(source, offset) {
    const before = source.slice(0, offset);
    const line = (before.match(/\n/g) ?? []).length;
    return {line, character: offset - (before.lastIndexOf("\n") + 1)};
}

/** [character] の位置のタグ名。 */
function tagNameAt(text, character) {
    TAG_NAME.lastIndex = 0;
    for (let match; (match = TAG_NAME.exec(text));) {
        const end = match.index + match[0].length;
        const start = end - match[1].length;
        if (start <= character && character <= end) return match[1];
    }
    return null;
}

/**
 * `render` が Astro の `component()`（`{type: "local", path}`）なら、プロジェクトルート [root] から解決したファイル。
 * ルートの外か、なければ `null`。
 */
function resolveComponent(render, root) {
    if (render?.type !== "local" || typeof render.path !== "string" || !root) return null;
    const target = path.resolve(root, render.path);
    return isFileInside(root, target) ? target : null;
}

/** 同じパスか（Windows では大文字と小文字を区別しない）。 */
function samePath(a, b) {
    if (!a || !b) return false;
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

module.exports = {
    MarkdocDefinitionProvider,
    tagNameAt,
    resolveComponent,
    variablePathAt,
    frontmatterKeyRange,
    findKeyPath
};
