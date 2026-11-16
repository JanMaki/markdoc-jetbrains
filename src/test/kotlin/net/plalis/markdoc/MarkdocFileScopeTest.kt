package net.plalis.markdoc

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.project.guessProjectDir
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/** [MarkdocFileScope] と [MarkdocFiles.isMarkdoc] のテスト。 */
class MarkdocFileScopeTest : BasePlatformTestCase() {
    /** `contentPaths` の中で `markdocExtensions` の拡張子を持つファイルだけを範囲に入れる。 */
    fun testContentPaths() {
        val root = myFixture.tempDirFixture.findOrCreateDir("scope")
        val scope = MarkdocFileScope.of(
            root,
            config("""{"contentPaths": ["pages", "markdoc/partials", "../outside", "/abs"], "markdocExtensions": [".MD", "mdoc"]}"""),
        )
        assertTrue(scope.contains(file("scope/pages/docs/index.md")))
        assertTrue(scope.contains(file("scope/pages/Upper.MD")))
        assertTrue(scope.contains(file("scope/markdoc/partials/footer.md")))
        assertTrue(scope.contains(file("scope/pages/a.mdoc")))
        assertFalse(scope.contains(file("scope/README.md")))
        assertFalse(scope.contains(file("scope/markdoc/tags.md")))
        assertFalse(scope.contains(file("scope/pages/a.txt")))
        // スキャンしないディレクトリの中は除く
        assertFalse(scope.contains(file("scope/pages/node_modules/pkg/README.md")))
        // ディレクトリは対象外
        assertFalse(scope.contains(myFixture.tempDirFixture.findOrCreateDir("scope/pages/dir.md")))
    }

    /** `contentPaths` がなければ `path` を、`markdocExtensions` がなければ何も範囲に入れない。 */
    fun testDefaults() {
        val root = myFixture.tempDirFixture.findOrCreateDir("defaults")
        val byPath = MarkdocFileScope.of(root, config("""{"path": "docs", "markdocExtensions": [".md"]}"""))
        assertTrue(byPath.contains(file("defaults/docs/a.md")))
        assertFalse(byPath.contains(file("defaults/a.md")))

        val noExtensions = MarkdocFileScope.of(root, config("""{"contentPaths": ["docs"]}"""))
        assertFalse(noExtensions.contains(file("defaults/docs/b.md")))
        assertFalse(MarkdocFileScope.of(root, null).contains(file("defaults/docs/c.md")))
    }

    /** `.mdoc` などはどこでも Markdoc ファイルとし、`.md` は設定ファイルの範囲の中だけ Markdoc ファイルとする。 */
    fun testIsMarkdoc() {
        val root = project.guessProjectDir()!!
        val path = { name: String -> root.path.removePrefix(myFixture.tempDirFixture.getFile("")!!.path).trim('/') + "/" + name }
        assertFalse(MarkdocFiles.isMarkdoc(project, file(path("pages/before.md"))))
        assertTrue(MarkdocFiles.isMarkdoc(project, file(path("anywhere/a.mdoc"))))
        assertTrue(MarkdocFiles.isMarkdoc(project, file(path("anywhere/b.markdoc.md"))))

        myFixture.tempDirFixture.createFile(
            path("markdoc.config.json"),
            """[{"contentPaths": ["pages"], "markdocExtensions": [".md"]}]""",
        )
        assertTrue(MarkdocFiles.isMarkdoc(project, file(path("pages/after.md"))))
        assertFalse(MarkdocFiles.isMarkdoc(project, file(path("README.md"))))
    }

    /** 一時ディレクトリの下の [path] に空のファイルを作る。 */
    private fun file(path: String) = myFixture.tempDirFixture.createFile(path, "")

    /** [json] の設定エントリ。 */
    private fun config(json: String): JsonObject = JsonParser.parseString(json).asJsonObject
}
