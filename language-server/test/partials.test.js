const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {
    ContentPartialRule,
    RelativePartialRule,
    DirectoryPartialRule,
    createPartialRule,
    parseJsonc,
    isFileInside,
} = require("../src/partials");

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

/** [root] のプロジェクトで、コンテンツのディレクトリを [content] にした、設定の `partialPaths` に合う規則。 */
function resolver(root, content, options = {}) {
    return createPartialRule({root, path: content, ...options}, {path: path.join(root, content)});
}

test("partialPaths の値で規則を選び、ない値はコンテンツのディレクトリから解決する", () => {
    const rule = (partialPaths) => createPartialRule({root: "/r", path: "", partialPaths}, {path: "/r"});
    assert.ok(rule("relative") instanceof RelativePartialRule);
    assert.ok(rule("content") instanceof ContentPartialRule);
    assert.ok(rule({directory: "markdoc/partials"}) instanceof DirectoryPartialRule);
    assert.ok(rule(undefined) instanceof ContentPartialRule);
    assert.ok(rule("unknown") instanceof ContentPartialRule);
    assert.ok(rule("constructor") instanceof ContentPartialRule);
    assert.ok(rule("directory") instanceof ContentPartialRule);
    assert.ok(rule({directory: 1}) instanceof ContentPartialRule);
});

test("directory：指定したディレクトリから解決し、境界はプロジェクトルート", () => {
    const root = project({
        "markdoc/partials/footer.md": "",
        "markdoc/partials/nested/header.mdoc": "",
        "markdoc/shared.md": "",
        "pages/index.md": "",
    });
    const r = resolver(root, "", {partialPaths: {directory: "markdoc/partials"}});
    const from = uri(root, "pages/index.md");
    const footer = path.join(root, "markdoc/partials/footer.md");
    assert.strictEqual(r.resolve("footer.md", from), footer);
    // @markdoc/next.js と同じく、先頭の / もディレクトリから
    assert.strictEqual(r.resolve("/footer.md", from), footer);
    assert.strictEqual(r.resolve("nested/header.mdoc", from), path.join(root, "markdoc/partials/nested/header.mdoc"));
    // 書いたファイルからではない
    assert.strictEqual(r.resolve("./footer.md", uri(root, "markdoc/partials/nested/header.mdoc")), footer);
    // ../ でディレクトリの外に出てもよいが、プロジェクトルートの外は読まない
    assert.strictEqual(r.resolve("../shared.md", from), path.join(root, "markdoc/shared.md"));
    assert.strictEqual(r.resolve("../../../outside.md", from), null);
    assert.strictEqual(r.resolve("missing.md", from), null);
});

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

test("relative：extends した tsconfig を編集すると別名を読み直す", () => {
    const root = project({
        "src/content/post.mdoc": "",
        "src/a/shared.mdoc": "",
        "src/b/shared.mdoc": "",
        "tsconfig.json": `{"extends": "./tsconfig.base.json"}`,
        "tsconfig.base.json": `{"compilerOptions": {"paths": {"@p/*": ["src/a/*"]}}}`,
    });
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const from = uri(root, "src/content/post.mdoc");
    assert.strictEqual(r.resolve("@p/shared.mdoc", from), path.join(root, "src/a/shared.mdoc"));

    const base = path.join(root, "tsconfig.base.json");
    fs.writeFileSync(base, `{"compilerOptions": {"paths": {"@p/*": ["src/b/*"]}}}`);
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(base, later, later);
    assert.strictEqual(r.resolve("@p/shared.mdoc", from), path.join(root, "src/b/shared.mdoc"));
});

test("relative：複数の extends から読む同じ tsconfig は、後の extends でも読み直して優先する", () => {
    const root = project({
        "src/content/post.mdoc": "",
        "src/a/shared.mdoc": "",
        "src/b/shared.mdoc": "",
        "tsconfig.json": `{"extends": ["./first.json", "./second.json"]}`,
        "first.json": `{"extends": "./shared.json"}`,
        "second.json": `{"extends": ["./other.json", "./shared.json"]}`,
        "other.json": `{"compilerOptions": {"paths": {"@p/*": ["src/b/*"]}}}`,
        "shared.json": `{"compilerOptions": {"paths": {"@p/*": ["src/a/*"]}}}`,
    });
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const from = uri(root, "src/content/post.mdoc");
    assert.strictEqual(r.resolve("@p/shared.mdoc", from), path.join(root, "src/a/shared.mdoc"));
});

test("relative：複数の経路から extends する tsconfig は 1 回だけ読む", (t) => {
    const root = project({
        "src/content/post.mdoc": "",
        "src/a/shared.mdoc": "",
        "tsconfig.json": `{"extends": ["./first.json", "./second.json"]}`,
        "first.json": `{"extends": "./shared.json"}`,
        "second.json": `{"extends": "./shared.json"}`,
        "shared.json": `{"compilerOptions": {"paths": {"@p/*": ["src/a/*"]}}}`,
    });
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    const read = t.mock.method(fs, "readFileSync");
    assert.strictEqual(r.resolve("@p/shared.mdoc", uri(root, "src/content/post.mdoc")), path.join(root, "src/a/shared.mdoc"));
    const shared = read.mock.calls.filter(({arguments: [file]}) => file === path.join(root, "shared.json"));
    assert.strictEqual(shared.length, 1);
});

test("relative：extends が循環していても読める", () => {
    const root = project({
        "src/content/post.mdoc": "",
        "src/a/shared.mdoc": "",
        "tsconfig.json": `{"extends": "./a.json", "compilerOptions": {"paths": {"@p/*": ["src/a/*"]}}}`,
        "a.json": `{"extends": "./tsconfig.json"}`,
    });
    const r = resolver(root, "src/content", {partialPaths: "relative"});
    assert.strictEqual(r.resolve("@p/shared.mdoc", uri(root, "src/content/post.mdoc")), path.join(root, "src/a/shared.mdoc"));
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

test("POSIX ではファイル名のバックスラッシュで区切らず、そのファイル自体を確かめる", {skip: process.platform === "win32"}, () => {
    const root = project({"x/y.mdoc": ""});
    const outside = project({"secret.mdoc": ""});
    // `x\y.mdoc` という名前のリンクが外を指す。`x/y.mdoc` を確かめて通してはいけない
    fs.symlinkSync(path.join(outside, "secret.mdoc"), path.join(root, "x\\y.mdoc"));
    assert.strictEqual(isFileInside(root, path.join(root, "x\\y.mdoc")), false);
    assert.strictEqual(isFileInside(root, path.join(root, "x/y.mdoc")), true);
});

test("tsconfig のコメントと末尾のカンマを読める", () => {
    assert.deepStrictEqual(parseJsonc('{"a": "// not a comment", /* c */ "b": [1, 2,],}'), {
        a: "// not a comment",
        b: [1, 2]
    });
    assert.deepStrictEqual(parseJsonc('{"a": "\\"/*\\""}'), {a: '"/*"'});
});
