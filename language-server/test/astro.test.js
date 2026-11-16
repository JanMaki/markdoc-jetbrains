const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {withMarkdocVariables} = require("../src/variables");
const {tagNameAt, resolveComponent} = require("../src/definition");

test("frontmatterVariable の名前の変数にフロントマターを入れる", () => {
    const frontmatter = {title: "T"};
    const variables = withMarkdocVariables({environment: "dev"}, frontmatter, {frontmatterVariable: "frontmatter"});
    assert.deepStrictEqual(variables, {environment: "dev", markdoc: {frontmatter}, frontmatter});
    // 先頭の $ は付けてもよい
    assert.strictEqual(withMarkdocVariables({}, frontmatter, {frontmatterVariable: "$fm"}).fm, frontmatter);
});

test("frontmatterVariable がなければ、スキーマに同じ名前があれば加えない", () => {
    assert.deepStrictEqual(withMarkdocVariables({a: 1}, {}, undefined), {a: 1, markdoc: {frontmatter: {}}});
    const own = withMarkdocVariables({frontmatter: "schema"}, {t: 1}, {frontmatterVariable: "frontmatter"});
    assert.strictEqual(own.frontmatter, "schema");
    // markdoc は組み込みの変数なので上書きしない
    const markdoc = withMarkdocVariables({}, {t: 1}, {frontmatterVariable: "markdoc"});
    assert.deepStrictEqual(markdoc, {markdoc: {frontmatter: {t: 1}}});
});

test("タグ名の上の位置からタグ名を取る", () => {
    const line = '{% aside type="tip" %} text {% /aside %}\n';
    assert.strictEqual(tagNameAt(line, 3), "aside");
    assert.strictEqual(tagNameAt(line, 8), "aside");
    assert.strictEqual(tagNameAt(line, 10), null);
    assert.strictEqual(tagNameAt(line, line.indexOf("/aside") + 2), "aside");
    assert.strictEqual(tagNameAt("{% $var %}", 4), null);
});

test("ローカルのコンポーネントをプロジェクトルートから解決する", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "markdoc-component-")));
    fs.mkdirSync(path.join(root, "src/components"), {recursive: true});
    fs.writeFileSync(path.join(root, "src/components/Aside.astro"), "");
    const component = path.join(root, "src/components/Aside.astro");
    assert.strictEqual(resolveComponent({type: "local", path: "./src/components/Aside.astro"}, root), component);
    assert.strictEqual(resolveComponent({type: "local", path: "./src/components/Missing.astro"}, root), null);
    assert.strictEqual(resolveComponent({type: "local", path: "../outside.astro"}, root), null);
    assert.strictEqual(resolveComponent({type: "package", path: "@astrojs/starlight/components"}, root), null);
    assert.strictEqual(resolveComponent("Callout", root), null);
    assert.strictEqual(resolveComponent(undefined, root), null);
});

const {variablePathAt, frontmatterKeyRange, findKeyPath} = require("../src/definition");

test("変数参照のカーソルがある階層までのキーを取る", () => {
    const line = "By {% $frontmatter.author.name %} and {% $user[\"display-name\"][0] %}";
    const at = (text) => line.indexOf(text) + 1;
    assert.deepStrictEqual(variablePathAt(line, at("$frontmatter")), ["frontmatter"]);
    assert.deepStrictEqual(variablePathAt(line, at("author")), ["frontmatter", "author"]);
    assert.deepStrictEqual(variablePathAt(line, at("name")), ["frontmatter", "author", "name"]);
    assert.deepStrictEqual(variablePathAt(line, at("display-name")), ["user", "display-name"]);
    assert.strictEqual(variablePathAt(line, 0), null);
});

test("添字の文字列の不正なエスケープでは失敗せずに null を返す", () => {
    const line = '{% $user["a\\qb"] %}';
    assert.strictEqual(variablePathAt(line, line.indexOf("qb")), null);
    assert.deepStrictEqual(variablePathAt('{% $user["a\\"b"] %}', 12), ["user", 'a"b']);
});

test("フロントマターのキーの行を探す", () => {
    const text = "---\ntitle: Why\n\"author\": Alice\nnested:\n  author: no\n---\n# body\n";
    assert.deepStrictEqual(frontmatterKeyRange(text, "title"), {
        start: {line: 1, character: 0},
        end: {line: 1, character: 5}
    });
    assert.deepStrictEqual(frontmatterKeyRange(text, "author"), {
        start: {line: 2, character: 1},
        end: {line: 2, character: 7}
    });
    // 見つからないキーとキーなしはフロントマターの先頭
    assert.deepStrictEqual(frontmatterKeyRange(text, "missing").start, {line: 0, character: 0});
    assert.deepStrictEqual(frontmatterKeyRange(text, undefined).start, {line: 0, character: 0});
    assert.strictEqual(frontmatterKeyRange("# no frontmatter\n", "title"), null);
});

test("スキーマのファイルで variables の後のキーを探す", () => {
    const source = "const environment = 1;\nexport default {\n  variables: {\n    environment: \"dev\",\n    user: {'name': 'a'},\n  },\n};\n";
    assert.strictEqual(source.slice(findKeyPath(source, ["environment"])).split(":")[0], "environment");
    assert.ok(findKeyPath(source, ["environment"]) > source.indexOf("variables"));
    assert.strictEqual(source.slice(findKeyPath(source, ["user", "name"])).split("'")[0], "name");
    assert.strictEqual(findKeyPath(source, ["missing"]), -1);
    assert.strictEqual(findKeyPath("export default {}", ["a"]), -1);
});

test("スキーマのキーは親のオブジェクトの直下のプロパティから選ぶ", () => {
    const source = "export default {\n  variables: {\n    a: {b: 1, /* b: */ c: \"b:\"},\n    // b: 0\n    b: {a: 1, c: {d: 1}, d: 2},\n  },\n};\n";
    const direct = source.indexOf("b: {a");
    assert.strictEqual(findKeyPath(source, ["b"]), direct);
    assert.strictEqual(findKeyPath(source, ["b", "d"]), source.indexOf("d: 2"));
    assert.strictEqual(findKeyPath(source, ["a", "c"]), source.indexOf("c: \""));
    assert.strictEqual(findKeyPath(source, ["a", "d"]), -1);
});

test("定義ジャンプはスキーマの変数の直下のプロパティへ移動する", () => {
    const {MarkdocDefinitionProvider} = require("../src/definition");
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "markdoc-definition-")));
    const source = "export default {\n  variables: {\n    site: {theme: {name: 1}},\n    name: 2,\n  },\n};\n";
    fs.writeFileSync(path.join(root, "markdoc.config.mjs"), source);
    const line = "{% $name %}\n";
    const provider = Object.create(MarkdocDefinitionProvider.prototype);
    provider.config = {root, schema: {path: "markdoc.config.mjs"}};
    provider.services = {
        Documents: {get: () => ({getText: () => line})},
        Schema: {get: () => ({tags: {}, variables: {site: {theme: {name: 1}}, name: 2}})},
    };
    const result = provider.onDefinition({textDocument: {uri: "file:///doc.mdoc"}, position: {line: 0, character: 5}});
    assert.strictEqual(result.uri, path.join(root, "markdoc.config.mjs"));
    assert.deepStrictEqual(result.range.start, {line: 3, character: 4});
});

const {MarkdocCompletionProvider, VARIABLE_PATTERN} = require("../src/completion");

/** [line] の末尾で変数の補完を求めたときの候補。 */
function variableItems(line) {
    const services = {
        Schema: {get: () => ({tags: {}, nodes: {}, variables: {environment: "dev"}})},
        Documents: {get: () => ({getText: () => line}), ast: () => null},
        Scanner: {frontmatter: () => ({})},
    };
    const connection = {
        onCompletion() {
        }, onCompletionResolve() {
        }
    };
    const provider = new MarkdocCompletionProvider({}, connection, services);
    const params = {textDocument: {uri: "file:///a.mdoc"}, position: {line: 0, character: line.length}};
    return provider.completeVariables(params, VARIABLE_PATTERN.exec(line));
}

test("{% の直後の変数の補完では、$ の前に空白を補う", () => {
    const [item] = variableItems("{%$e");
    assert.strictEqual(item.textEdit.newText, " $environment");
    assert.deepStrictEqual(item.textEdit.range.start, {line: 0, character: 2});
    assert.strictEqual(item.filterText, "$environment");
});

test("空白があれば補わない", () => {
    const [spaced] = variableItems("{% $e");
    assert.strictEqual(spaced.textEdit.newText, "environment");
    assert.deepStrictEqual(spaced.textEdit.range.start, {line: 0, character: 4});
    assert.strictEqual(variableItems('{% if equals($e')[0].textEdit.newText, "environment");
});
