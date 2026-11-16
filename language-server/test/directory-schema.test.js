const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {MarkdocSchema, DirectorySchemaSource, createSchemaSource} = require("../src/schema");
const {MarkdocDefinitionProvider} = require("../src/definition");
const {stubSource} = require("../src/module-loader");

/**
 * markdoc-vinext-plugin の examples/basic と同じ構成のスキーマのディレクトリ。
 * コンポーネント（TSX・JSX）、Next.js のパッケージ、tsconfig の別名、スタイルシート、読み込めないパッケージ、
 * フォルダの index、default と名前付きの export、config による上書きを含む。
 */
const NEXT_PROJECT = {
    "tsconfig.json": `{"compilerOptions": {"paths": {"@/*": ["./*"]}}}`,
    "markdoc/tags.ts": `
import {createElement} from 'react';
import Link from 'next/link';
import {Callout} from './components/Callout';
import {Badge} from '@/components/Badge';
import {head, link} from '@markdoc/next.js/tags';
import broken from 'broken-package';
import './styles.css';

const tags = {
  callout: {
    render: Callout,
    attributes: {type: {type: String, default: 'info', matches: ['info', 'warn']}},
  },
  tag: {
    render: function Tag() {
      return createElement('span', null, 'custom-tag');
    },
  },
  badge: {render: Badge},
  link: {...link, render: Link},
  head,
  broken: {render: broken},
};

export default tags;
export const callout = tags.callout;
`,
    "markdoc/components/Callout.tsx": `
import type {ReactNode} from 'react';

export function Callout({children}: {children: ReactNode}) {
  return <div className="callout">{children}</div>;
}
`,
    "components/Badge.jsx": "export const Badge = () => <span className=\"badge\" />;\n",
    "markdoc/nodes/index.ts": "export const heading = {attributes: {id: {type: String}}};\n",
    "markdoc/functions.ts": "export default {upper: {transform: (p: unknown[]) => String(p[0]).toUpperCase()}};\n",
    "markdoc/config.ts": `
const config = {
  variables: {product: 'Vinext'},
  functions: {only: {transform: () => 'only'}},
};
export default config;
`,
    "markdoc/partials/footer.md": "Footer\n",
    "node_modules/@markdoc/next.js/package.json": `{"name": "@markdoc/next.js", "exports": {"./*": "./src/*.js"}}`,
    "node_modules/@markdoc/next.js/src/tags.js": `
const Head = require('next/head');
const Link = require('next/link');
exports.head = {render: Head, attributes: {}};
exports.link = {render: Link, attributes: {href: {type: String, required: true}}};
`,
    "node_modules/broken-package/package.json": `{"name": "broken-package", "main": "index.js"}`,
    "node_modules/broken-package/index.js": "throw new Error('broken');\n",
};

/** 一時ディレクトリに [files]（パス → 中身）を作り、そのディレクトリの実パスを返す。 */
function project(files) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "markdoc-directory-schema-")));
    for (const [file, content] of Object.entries(files)) {
        const full = path.join(root, file);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        fs.writeFileSync(full, content);
    }
    return root;
}

/** [root] の `markdoc` ディレクトリを読む [DirectorySchemaSource]。 */
function source(root) {
    return createSchemaSource({root, schema: {path: "markdoc", type: "nextjs"}});
}

/** [file] の更新時刻を 10 秒後にする。 */
function touch(file) {
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(file, later, later);
}

test("schema.type が nextjs ならスキーマのディレクトリとして読む", () => {
    assert.ok(source("/r") instanceof DirectorySchemaSource);
});

test("tags・nodes・functions・config を @markdoc/next.js と同じくまとめる", async () => {
    const root = project(NEXT_PROJECT);
    const schema = await source(root).load();

    assert.deepStrictEqual(schema.tags.callout.attributes.type.matches, ["info", "warn"]);
    assert.strictEqual(typeof schema.tags.tag.render, "function");
    // @markdoc/next.js/tags の属性の定義を読む
    assert.strictEqual(schema.tags.link.attributes.href.required, true);
    assert.deepStrictEqual(schema.tags.head.attributes, {});
    // 名前付きの export だけのフォルダの index
    assert.deepStrictEqual(Object.keys(schema.nodes), ["heading"]);
    // config は最後に展開するので functions を上書きする
    assert.deepStrictEqual(Object.keys(schema.functions), ["only"]);
    assert.deepStrictEqual(schema.variables, {product: "Vinext"});
});

test("React・Next.js のパッケージ、スタイルシート、読み込めないパッケージはスタブにする", async () => {
    const root = project(NEXT_PROJECT);
    const directory = source(root);
    const schema = await directory.load();

    assert.strictEqual(stubSource(schema.tags.link.render), "next/link");
    assert.strictEqual(stubSource(schema.tags.head.render), "next/head");
    assert.strictEqual(stubSource(schema.tags.broken.render), "broken-package");
    assert.deepStrictEqual(directory.loader.failures.map(({source}) => source), ["broken-package"]);
    // スタブは呼んでもプロパティを読んでも失敗しない
    assert.strictEqual(stubSource(schema.tags.link.render().anything()), "next/link");
});

test("読み込んだプロジェクトのファイルを返し、パッケージのファイルは含めない", async () => {
    const root = project(NEXT_PROJECT);
    const directory = source(root);
    await directory.load();
    const relative = directory.files().map((file) => path.relative(root, file).split(path.sep).join("/"));
    assert.deepStrictEqual(relative, [
        "markdoc/tags.ts",
        "markdoc/components/Callout.tsx",
        "components/Badge.jsx",
        "markdoc/nodes/index.ts",
        "markdoc/functions.ts",
        "markdoc/config.ts",
    ]);
});

test("render のコンポーネントの import 元のファイルを返す", async () => {
    const root = project(NEXT_PROJECT);
    const directory = source(root);
    const schema = await directory.load();
    assert.strictEqual(directory.componentFile(schema.tags.callout.render), path.join(root, "markdoc/components/Callout.tsx"));
    assert.strictEqual(directory.componentFile(schema.tags.badge.render), path.join(root, "components/Badge.jsx"));
    // パッケージのスタブと、その場で書いた関数は分からない
    assert.strictEqual(directory.componentFile(schema.tags.link.render), null);
    assert.strictEqual(directory.componentFile(schema.tags.tag.render), null);
});

test("ディレクトリがなければ schema.path を確かめるよう伝え、読めないファイルはその理由を伝える", async () => {
    const missing = source(project({}));
    await assert.rejects(() => missing.load());
    assert.match(missing.describeError(new Error("x")), /schema directory .* does not exist/);

    const root = project({"markdoc/tags.ts": "export default {"});
    const broken = source(root);
    const error = await broken.load().catch((caught) => caught);
    assert.ok(error instanceof Error);
    assert.match(broken.describeError(error), /Failed to load the schema in .*tags\.ts: /);
    // 読めなかったファイルも、直したら読み直せるように見る
    assert.deepStrictEqual(broken.files(), [path.join(root, "markdoc/tags.ts")]);
});

test("読み込んだファイルとスキーマのディレクトリの更新時刻が変わったら読み直す", async () => {
    const root = project(NEXT_PROJECT);
    const connection = {console: {error: () => {}}, window: {showErrorMessage: () => {}}};
    const schema = new MarkdocSchema({root, schema: {path: "markdoc", type: "nextjs", watch: true}}, connection);
    await schema.reload();
    assert.strictEqual(schema.source.changed(), false);
    assert.deepStrictEqual(schema.get("file:///a.md").variables, {product: "Vinext"});

    const config = path.join(root, "markdoc/config.ts");
    fs.writeFileSync(config, "export default {variables: {product: 'Next.js'}};\n");
    touch(config);
    assert.strictEqual(schema.source.changed(), true);
    schema.checkedAt = 0;
    schema.get("file:///a.md");
    await schema.reloading;
    assert.deepStrictEqual(schema.get("file:///a.md").variables, {product: "Next.js"});

    // 新しいモジュールのディレクトリができても読み直す
    fs.mkdirSync(path.join(root, "markdoc/tags"));
    assert.strictEqual(schema.source.changed(), true);
});

test("schema.watch がなければ読み直さない", async () => {
    const root = project(NEXT_PROJECT);
    const schema = new MarkdocSchema({root, schema: {path: "markdoc", type: "nextjs"}}, null);
    await schema.reload();
    const config = path.join(root, "markdoc/config.ts");
    fs.writeFileSync(config, "export default {variables: {product: 'Next.js'}};\n");
    touch(config);
    schema.checkedAt = 0;
    schema.get("file:///a.md");
    assert.strictEqual(schema.reloading, null);
});

/** [root] のスキーマを読んだ [MarkdocSchema] で、[line] の [character] の位置から定義ジャンプする。 */
async function definition(root, line, character) {
    const schema = new MarkdocSchema({root, schema: {path: "markdoc", type: "nextjs"}}, null);
    await schema.reload();
    const provider = Object.create(MarkdocDefinitionProvider.prototype);
    provider.config = {root, schema: {path: "markdoc", type: "nextjs"}};
    provider.services = {
        Documents: {get: () => ({getText: () => line}), ast: () => null},
        Schema: schema,
    };
    return provider.onDefinition({textDocument: {uri: "file:///doc.md"}, position: {line: 0, character}});
}

test("タグ名からコンポーネントの import 元のファイルへ移動する", async () => {
    const root = project(NEXT_PROJECT);
    assert.strictEqual((await definition(root, "{% callout %}\n", 4)).uri, path.join(root, "markdoc/components/Callout.tsx"));
    assert.strictEqual((await definition(root, "{% badge /%}\n", 4)).uri, path.join(root, "components/Badge.jsx"));
});

test("コンポーネントが分からなければ、スキーマのファイルでタグを定義した位置へ移動する", async () => {
    const root = project(NEXT_PROJECT);
    const tags = fs.readFileSync(path.join(root, "markdoc/tags.ts"), "utf8");
    const result = await definition(root, "{% tag /%}\n", 4);
    assert.strictEqual(result.uri, path.join(root, "markdoc/tags.ts"));
    const before = tags.slice(0, tags.indexOf("  tag: {") + 2).split("\n");
    assert.deepStrictEqual(result.range.start, {line: before.length - 1, character: 2});
    // スキーマにないタグは探さない
    assert.strictEqual(await definition(root, "{% missing /%}\n", 4), null);
});

test("スキーマの variables を config のファイルから探す", async () => {
    const root = project(NEXT_PROJECT);
    const result = await definition(root, "{% $product %}\n", 5);
    assert.strictEqual(result.uri, path.join(root, "markdoc/config.ts"));
    assert.deepStrictEqual(result.range.start, {line: 2, character: 14});
});
