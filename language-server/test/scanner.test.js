const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {FsPathScanner} = require("../src/scanner");

/** Next.js のプロジェクトの配置に、スキャンしないディレクトリとコンテンツの外のファイルを加えたもの。 */
const FILES = {
    "README.md": "",
    "pages/docs/getting-started.md": "",
    "app/docs/page.md": "",
    "markdoc/partials/footer.md": "",
    "markdoc/tags.ts": "",
    "node_modules/pkg/README.md": "",
    "pages/node_modules/pkg/README.md": "",
    ".next/server/page.md": "",
    ".git/info/notes.md": "",
};

/**
 * 一時ディレクトリに [files]（パス → 中身）を作り、そのディレクトリの実パスを返す。
 * vscode-uri の `fsPath` と同じく、Windows のドライブ文字は小文字にする。
 */
function project(files) {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "markdoc-scanner-")));
    const root = /^[A-Z]:/.test(real) ? real[0].toLowerCase() + real.slice(1) : real;
    for (const [file, content] of Object.entries(files)) {
        const full = path.join(root, file);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        fs.writeFileSync(full, content);
    }
    return root;
}

/** スキャンしたファイルの、基準パスからの相対パス（並べ替え済み）。 */
async function scanned(config) {
    const scanner = new FsPathScanner(config);
    await scanner.scan();
    return {scanner, files: [...scanner.entries()].map(([file]) => file).sort()};
}

test("contentPaths があれば、その各ディレクトリだけをスキャンする", async () => {
    const root = project(FILES);
    const {files} = await scanned({root, path: "", contentPaths: ["pages", "app", "markdoc/partials", "../outside"]});
    assert.deepStrictEqual(files, ["app/docs/page.md", "markdoc/partials/footer.md", "pages/docs/getting-started.md"]);
});

test("contentPaths がなければ path をスキャンし、node_modules・.next・.git には入らない", async () => {
    const root = project(FILES);
    const {files} = await scanned({root, path: ""});
    assert.deepStrictEqual(files, [
        "README.md",
        "app/docs/page.md",
        "markdoc/partials/footer.md",
        "pages/docs/getting-started.md",
    ]);
});

test("スキャンの対象の外のファイルの変更は無視する", async () => {
    const root = project(FILES);
    const {scanner} = await scanned({root, path: "", contentPaths: ["pages"]});
    await scanner.update(path.join(root, "README.md"));
    await scanner.update(path.join(root, "pages/node_modules/pkg/README.md"));
    assert.deepStrictEqual([...scanner.entries()].map(([file]) => file), ["pages/docs/getting-started.md"]);

    fs.writeFileSync(path.join(root, "pages/new.md"), "");
    await scanner.update(path.join(root, "pages/new.md"));
    assert.ok(scanner.has(path.join(root, "pages/new.md")));
    assert.ok(scanner.matches(path.join(root, "pages/new.md")));
    assert.ok(!scanner.matches(path.join(root, "README.md")));
});

test("contentPaths に使える値がなければ path をスキャンする", async () => {
    const root = project(FILES);
    const {files} = await scanned({root, path: "pages", contentPaths: [1, "../outside"]});
    assert.deepStrictEqual(files, ["docs/getting-started.md"]);
});
