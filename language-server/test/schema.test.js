const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {MarkdocSchema, NodeSchemaSource, EsmSchemaSource, createSchemaSource} = require("../src/schema");

/** 一時ディレクトリに [files]（パス → 中身）を作り、そのディレクトリの実パスを返す。 */
function project(files) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "markdoc-schema-")));
    for (const [file, content] of Object.entries(files)) {
        const full = path.join(root, file);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        fs.writeFileSync(full, content);
    }
    return root;
}

test("schema.type で読み込み方を選び、ない値は ESM として読む", () => {
    const source = (type) => createSchemaSource({root: "/r", schema: {path: "s.js", type}});
    assert.ok(source("node") instanceof NodeSchemaSource);
    assert.ok(source("esm") instanceof EsmSchemaSource);
    assert.ok(source(undefined) instanceof EsmSchemaSource);
    assert.ok(source("constructor") instanceof EsmSchemaSource);
});

test("node は require で読み、property のプロパティを使う", async () => {
    const root = project({"schema.cjs": "module.exports = {schema: {tags: {a: {}}}};"});
    const whole = await createSchemaSource({root, schema: {path: "schema.cjs", type: "node"}}).load();
    assert.deepStrictEqual(whole, {schema: {tags: {a: {}}}});
    const property = await createSchemaSource({root, schema: {path: "schema.cjs", type: "node", property: "schema"}}).load();
    assert.deepStrictEqual(property, {tags: {a: {}}});
});

test("esm は import で読み、既定は default の export を使う", async () => {
    const root = project({"schema.mjs": "export default {tags: {a: {}}}; export const other = 1;"});
    assert.deepStrictEqual(await createSchemaSource({root, schema: {path: "schema.mjs"}}).load(), {tags: {a: {}}});
    assert.strictEqual(await createSchemaSource({root, schema: {path: "schema.mjs", property: "other"}}).load(), 1);
});

test("読めなければ理由を通知し、ないファイルは schema.path を確かめるよう伝える", async () => {
    const root = project({});
    const messages = [];
    const connection = {
        console: {error: (message) => messages.push(message)},
        window: {showErrorMessage: () => {}},
    };
    const schema = new MarkdocSchema({root, schema: {path: "missing.mjs"}}, connection);
    assert.strictEqual(await schema.load(), undefined);
    assert.match(messages[0], /does not exist\. Check schema\.path/);
});

test("schema.path がなければ読まない", async () => {
    const schema = new MarkdocSchema({root: "/r"}, null);
    assert.strictEqual(schema.source, null);
    assert.strictEqual(await schema.load(), undefined);
});
