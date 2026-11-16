const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {PartialResolver, parseJsonc} = require("../src/partials");

/** 一時ディレクトリに [files]（パス → 中身）を作り、そのディレクトリの実パスを返す。 */
function project(files) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "markdoc-partials-")));
    for (const [file, content] of Object.entries(files)) {
        const full = path.join(root, file);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        fs.writeFileSync(full, content);
    }
    return root;
}

/** [root] のプロジェクトで、コンテンツのディレクトリを [content] にした PartialResolver。 */
function resolver(root, content, options = {}) {
    return new PartialResolver({root, path: content, ...options}, {path: path.join(root, content)});
}

const uri = (root, file) => pathToFileURL(path.join(root, file)).href;

const ASTRO = {
    "src/content/blog/post.mdoc": "",
    "src/content/blog/_footer.mdoc": "",
    "src/content/blog/guides/nested.mdoc": "",
    "src/partials/shared.mdoc": "",
    "outside.mdoc": "",
    "tsconfig.json": `{
        // 別名
        "extends": "astro/tsconfigs/strict",
        "compilerOptions": {
            "baseUrl": ".",
            "paths": {"@partials/*": ["src/partials/*"], "@footer": ["src/content/blog/_footer.mdoc"],},
        },
    }`,
};

test("content：コンテンツのディレクトリから解決する（上流と同じ）", () => {
    const root = project({"docs/partials/footer.mdoc": "", "docs/index.mdoc": ""});
    const r = resolver(root, "docs");
    const from = uri(root, "docs/index.mdoc");
    assert.strictEqual(r.resolve("partials/footer.mdoc", from), path.join(root, "docs/partials/footer.mdoc"));
    assert.strictEqual(r.resolve("/partials/footer.mdoc", from), path.join(root, "docs/partials/footer.mdoc"));
    assert.strictEqual(r.resolve("partials/missing.mdoc", from), null);
    assert.strictEqual(r.resolve("../docs/index.mdoc", from), path.join(root, "docs/index.mdoc"));
    assert.strictEqual(r.resolve("../outside.mdoc", from), null);
});

test("relative：書いたファイルからの相対パスで解決する", () => {
    const root = project(ASTRO);
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const footer = path.join(root, "src/content/blog/_footer.mdoc");
    assert.strictEqual(r.resolve("./_footer.mdoc", uri(root, "src/content/blog/post.mdoc")), footer);
    assert.strictEqual(r.resolve("../_footer.mdoc", uri(root, "src/content/blog/guides/nested.mdoc")), footer);
    // ./ のないパスも書いたファイルから（Astro は ./ を付けて解決し直す）
    assert.strictEqual(r.resolve("_footer.mdoc", uri(root, "src/content/blog/post.mdoc")), footer);
    assert.strictEqual(r.resolve("./_footer.mdoc", uri(root, "src/content/blog/guides/nested.mdoc")), null);
});

test("relative：/ はプロジェクトルートから、コンテンツの外の partial も読める", () => {
    const root = project(ASTRO);
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const from = uri(root, "src/content/blog/post.mdoc");
    assert.strictEqual(r.resolve("/src/partials/shared.mdoc", from), path.join(root, "src/partials/shared.mdoc"));
    assert.strictEqual(r.resolve("../../partials/shared.mdoc", from), path.join(root, "src/partials/shared.mdoc"));
    // プロジェクトルートの外は読まない
    assert.strictEqual(r.resolve("../../../../outside.mdoc", from), null);
});

test("relative：tsconfig.json の paths の別名で解決する", () => {
    const root = project(ASTRO);
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const from = uri(root, "src/content/blog/post.mdoc");
    assert.strictEqual(r.resolve("@partials/shared.mdoc", from), path.join(root, "src/partials/shared.mdoc"));
    assert.strictEqual(r.resolve("@footer", from), path.join(root, "src/content/blog/_footer.mdoc"));
    assert.strictEqual(r.resolve("@partials/missing.mdoc", from), null);
});

test("relative：extends した tsconfig の baseUrl から子の別名を解決する", () => {
    const root = project({
        "src/content/post.mdoc": "",
        "src/partials/shared.mdoc": "",
        "partials/shared.mdoc": "",
        "config/tsconfig.base.json": `{"compilerOptions": {"baseUrl": "../src"}}`,
        "tsconfig.json": `{"extends": "./config/tsconfig.base.json", "compilerOptions": {"paths": {"@p/*": ["partials/*"]}}}`,
    });
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const from = uri(root, "src/content/post.mdoc");
    assert.strictEqual(r.resolve("@p/shared.mdoc", from), path.join(root, "src/partials/shared.mdoc"));
});

test("UNC パスと絶対パスは扱わない", () => {
    const root = project(ASTRO);
    for (const options of [{}, {partialPaths: "relative"}]) {
        const r = resolver(root, "src/content", options);
        const from = uri(root, "src/content/blog/post.mdoc");
        assert.strictEqual(r.resolve("//server/share/a.mdoc", from), null);
        assert.strictEqual(r.resolve("\\\\server\\share\\a.mdoc", from), null);
        assert.strictEqual(r.resolve("C:\\a.mdoc", from), null);
        assert.strictEqual(r.resolve("", from), null);
        assert.strictEqual(r.resolve(undefined, from), null);
    }
});

test("シンボリックリンクで境界の外へ出るファイルは読まない", {skip: process.platform === "win32"}, () => {
    const root = project(ASTRO);
    fs.symlinkSync(path.join(root, "outside.mdoc"), path.join(root, "src/content/blog/_link.mdoc"));
    const r = resolver(root, "src/content");
    assert.strictEqual(r.resolve("blog/_link.mdoc", uri(root, "src/content/blog/post.mdoc")), null);
});

test("tsconfig のコメントと末尾のカンマを読める", () => {
    assert.deepStrictEqual(parseJsonc('{"a": "// not a comment", /* c */ "b": [1, 2,],}'), {
        a: "// not a comment",
        b: [1, 2]
    });
    assert.deepStrictEqual(parseJsonc('{"a": "\\"/*\\""}'), {a: '"/*"'});
});
