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

/**
 * [source] で `variables` のオブジェクトから [keys]（`name:`、`"name":`）を順にたどり、最後のキーの位置を返す。
 * 各キーは、1 つ前のキーの値のオブジェクトの直下のプロパティからだけ探す（入れ子の同名のキーは選ばない）。なければ -1。
 */
function findKeyPath(source, keys) {
    let value = findVariables(source);
    if (value < 0) return -1;
    let found = -1;
    for (const key of keys) {
        const open = skipTrivia(source, value);
        if (source[open] !== "{") return -1;
        const property = directProperty(source, open, key);
        if (!property) return -1;
        found = property.offset;
        value = property.value;
    }
    return found;
}

/** [source] のプロパティ `variables`（`variables:`、`"variables":`）の値の先頭（`:` の直後）。文字列、コメント、正規表現の中は除く。なければ -1。 */
function findVariables(source) {
    let i = 0;
    while (i < source.length) {
        const char = source[i];
        let end;
        let name = null;
        if (/[A-Za-z_$]/.test(char)) {
            end = i;
            while (end < source.length && /[\w$]/.test(source[end])) end++;
            if (source[i - 1] !== ".") name = source.slice(i, end);
        } else if (char === '"' || char === "'") {
            end = skipString(source, i);
            name = decodeString(source.slice(i + 1, end - 1));
        } else {
            const literal = skipLiteral(source, i);
            i = literal >= 0 ? literal : i + 1;
            continue;
        }
        if (name === "variables") {
            const colon = skipTrivia(source, end);
            if (source[colon] === ":") return colon + 1;
        }
        i = end;
    }
    return -1;
}

/**
 * [open] の `{` から始まるオブジェクトの直下のプロパティ [key] の、キーの位置と値の先頭（`:` の直後）。
 * 文字列、テンプレート文字列、コメント、正規表現の中と、入れ子の括弧の中は読み飛ばす。なければ `null`。
 */
function directProperty(source, open, key) {
    let depth = 0;
    let expectKey = true;
    let i = open + 1;
    while (i < source.length) {
        const char = source[i];
        if (/\s/.test(char)) {
            i++;
        } else if (char === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
            i = skipTrivia(source, i);
        } else if (depth === 0 && expectKey && (/[A-Za-z_$]/.test(char) || char === '"' || char === "'")) {
            expectKey = false;
            let name;
            let end;
            let offset = i;
            if (char === '"' || char === "'") {
                end = skipString(source, i);
                name = decodeString(source.slice(i + 1, end - 1));
                offset = i + 1;
            } else {
                end = i;
                while (end < source.length && /[\w$]/.test(source[end])) end++;
                name = source.slice(i, end);
            }
            const colon = skipTrivia(source, end);
            if (source[colon] === ":" && name === key) return {offset, value: colon + 1};
            i = end;
        } else if (char === '"' || char === "'" || char === "`" || char === "/") {
            const literal = skipLiteral(source, i);
            i = literal >= 0 ? literal : i + 1;
        } else if (char === "{" || char === "[" || char === "(") {
            depth++;
            i++;
        } else if (char === "}" || char === "]" || char === ")") {
            if (--depth < 0) return null;
            i++;
        } else {
            if (depth === 0 && char === ",") expectKey = true;
            i++;
        }
    }
    return null;
}

/** [from] から空白とコメントを読み飛ばした位置。 */
function skipTrivia(source, from) {
    let i = from;
    while (i < source.length) {
        if (/\s/.test(source[i])) {
            i++;
        } else if (source.startsWith("//", i)) {
            const end = source.indexOf("\n", i);
            i = end < 0 ? source.length : end + 1;
        } else if (source.startsWith("/*", i)) {
            const end = source.indexOf("*/", i + 2);
            i = end < 0 ? source.length : end + 2;
        } else {
            break;
        }
    }
    return i;
}

/** [open] の引用符から始まる文字列の直後の位置。閉じていなければ末尾。 */
function skipString(source, open) {
    const quote = source[open];
    let i = open + 1;
    while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
    return Math.min(i + 1, source.length);
}

/** 直後に置くと `/` が正規表現の始まりになるキーワード。 */
const REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

/** [i] から始まる文字列、テンプレート文字列、コメント、正規表現リテラルの直後の位置。どれでもなければ -1。 */
function skipLiteral(source, i) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") return skipString(source, i);
    if (char !== "/") return -1;
    if (source[i + 1] === "/" || source[i + 1] === "*") return skipTrivia(source, i);
    return regexAllowed(source, i) ? skipRegex(source, i) : -1;
}

/** [i] の `/` が除算ではなく正規表現の始まりか（直前の字句で判断する）。 */
function regexAllowed(source, i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(source[j])) j--;
    if (j < 0) return true;
    if (/[)\]}]/.test(source[j])) return false;
    if (!/[\w$]/.test(source[j])) return true;
    let start = j;
    while (start > 0 && /[\w$]/.test(source[start - 1])) start--;
    return REGEX_KEYWORDS.has(source.slice(start, j + 1));
}

/** [open] の `/` から始まる正規表現リテラル（フラグを含む）の直後の位置。行内で閉じていなければ -1。 */
function skipRegex(source, open) {
    let i = open + 1;
    let inClass = false;
    while (i < source.length && source[i] !== "\n") {
        const char = source[i];
        if (char === "\\") {
            i += 2;
            continue;
        }
        if (char === "[") inClass = true;
        else if (char === "]") inClass = false;
        else if (char === "/" && !inClass) {
            i++;
            while (i < source.length && /[A-Za-z]/.test(source[i])) i++;
            return i;
        }
        i++;
    }
    return -1;
}

/** JavaScript の文字列リテラルの中身 [body] のエスケープを戻す。 */
function decodeString(body) {
    const simple = {n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0"};
    return body.replace(/\\(u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|\r\n|[\s\S])/g, (_, escape) => {
        if (escape.length > 2) return String.fromCodePoint(parseInt(escape.replace(/[ux{}]/g, ""), 16));
        if (/^(\r\n|[\r\n\u2028\u2029])$/.test(escape)) return "";
        return simple[escape] ?? escape;
    });
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
