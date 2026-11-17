package net.plalis.markdoc.config.framework

import com.google.gson.JsonParser
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/** [AstroFramework] の判定、エントリ、設定の読み取りのテスト。 */
class AstroFrameworkTest : BasePlatformTestCase() {
    /** `markdoc()` の引数の `ignoreIndentation`・`allowHTML` を読む。 */
    fun testAllowsIndentation() {
        assertTrue(AstroFramework.allowsIndentation("markdoc({ ignoreIndentation: true })"))
        assertTrue(AstroFramework.allowsIndentation("markdoc({ \"allowHTML\" : true })"))
        // import の名前で呼び出しを探す
        assertTrue(
            AstroFramework.allowsIndentation(
                "import md from '@astrojs/markdoc';\nexport default { integrations: [md({ allowHTML: true })] };",
            ),
        )
        assertFalse(
            AstroFramework.allowsIndentation(
                "import md from '@astrojs/markdoc';\nmarkdoc({ allowHTML: true });",
            ),
        )
        assertFalse(AstroFramework.allowsIndentation("markdoc({ ignoreIndentation: false })"))
        assertFalse(AstroFramework.allowsIndentation("markdoc({ ignoreIndentation: trueish })"))
        // コメントと文字列の中は見ない
        assertFalse(AstroFramework.allowsIndentation("markdoc({ /* allowHTML: true */ })"))
        assertFalse(AstroFramework.allowsIndentation("markdoc({ a: 'allowHTML: true' })"))
        // ほかの関数とプロパティの呼び出しは対象外
        assertFalse(AstroFramework.allowsIndentation("other({ allowHTML: true }); x.markdoc({ allowHTML: true })"))
        // 最初の引数のプロパティの値だけを読む
        assertFalse(AstroFramework.allowsIndentation("markdoc({ nested: { allowHTML: true } })"))
        assertFalse(AstroFramework.allowsIndentation("markdoc({ allowHTML: isDev })"))
        assertFalse(AstroFramework.allowsIndentation("markdoc({ allowHTML: true && isDev })"))
        assertTrue(AstroFramework.allowsIndentation("markdoc({ allowHTML: false, ignoreIndentation: true })"))
    }

    /** Astro の設定ファイルか依存のどちらかで Astro のプロジェクトとみなす。 */
    fun testDetect() {
        val root = myFixture.tempDirFixture.findOrCreateDir(ROOT)
        assertFalse(AstroFramework.detect(root))
        assertNull(MarkdocFramework.of(root))

        myFixture.tempDirFixture.createFile("$ROOT/package.json", """{"devDependencies": {"@astrojs/markdoc": "1"}}""")
        assertTrue(AstroFramework.detect(root))
        assertSame(AstroFramework, MarkdocFramework.of(root))
    }

    /** 雛形はスキーマのファイルがなくても作り、設定ファイルがないときのエントリはスキーマのファイルがあるときだけ作る。 */
    fun testEntries() {
        val root = myFixture.tempDirFixture.findOrCreateDir(ROOT)
        myFixture.tempDirFixture.createFile("$ROOT/astro.config.mjs", "markdoc({ ignoreIndentation: true })")
        assertNull(AstroFramework.defaultEntry(root))

        val template = JsonParser.parseString(AstroFramework.templateText(root)).asJsonArray.single().asJsonObject
        assertEquals("astro", template.get("id").asString)
        assertEquals("markdoc.config.mjs", template.getAsJsonObject("schema").get("path").asString)
        assertTrue(template.getAsJsonObject("markdoc").get("allowIndentation").asBoolean)
        assertEquals("relative", template.get("partialPaths").asString)

        myFixture.tempDirFixture.createFile("$ROOT/markdoc.config.ts", "")
        val entry = AstroFramework.defaultEntry(root)!!
        assertEquals("markdoc.config.ts", entry.getAsJsonObject("schema").get("path").asString)
        assertEquals("frontmatter", entry.get("frontmatterVariable").asString)
        assertTrue(entry.get("ignoreUndefinedVariables").asBoolean)
    }

    private companion object {
        /** テストのプロジェクトルートにする、一時ディレクトリの下のディレクトリ。 */
        const val ROOT = "astro"
    }
}
