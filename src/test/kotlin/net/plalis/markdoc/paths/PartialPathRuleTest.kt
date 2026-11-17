package net.plalis.markdoc.paths

import com.google.gson.JsonParser
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/** [PartialPathRule] の選び方と基準のテスト。 */
class PartialPathRuleTest : BasePlatformTestCase() {
    /** `partialPaths` の値で規則を選ぶ。 */
    fun testFrom() {
        assertEquals(PartialPathRule.Content(null), rule("""{}"""))
        assertEquals(PartialPathRule.Content("docs"), rule("""{"path": "docs", "partialPaths": "content"}"""))
        assertEquals(PartialPathRule.Content("docs"), rule("""{"path": "docs", "partialPaths": "unknown"}"""))
        assertEquals(PartialPathRule.Content(null), rule("""{"partialPaths": "directory"}"""))
        assertEquals(PartialPathRule.Content(null), rule("""{"partialPaths": {"directory": 1}}"""))
        assertEquals(PartialPathRule.Relative, rule("""{"partialPaths": "relative"}"""))
        assertEquals(
            PartialPathRule.Directory("markdoc/partials"),
            rule("""{"partialPaths": {"directory": "markdoc/partials"}}"""),
        )
        assertEquals(PartialPathRule.Content(null), PartialPathRule.from(null))
    }

    /** 規則ごとの基準のディレクトリ。 */
    fun testBase() {
        val root = myFixture.tempDirFixture.findOrCreateDir("rules")
        val partials = myFixture.tempDirFixture.findOrCreateDir("rules/markdoc/partials")
        val docs = myFixture.tempDirFixture.findOrCreateDir("rules/docs")
        val page = myFixture.tempDirFixture.createFile("rules/pages/index.md", "")

        assertEquals(partials, PartialPathRule.Directory("markdoc/partials").base(root, page, "footer.md")?.directory)
        assertEquals(partials, PartialPathRule.Directory("/markdoc/partials/").base(root, page, "/footer.md")?.directory)
        assertNull(PartialPathRule.Directory("missing").base(root, page, "footer.md"))
        // プロジェクトルートの外のディレクトリは基準にしない
        myFixture.tempDirFixture.findOrCreateDir("outside")
        assertNull(PartialPathRule.Directory("../outside").base(root, page, "footer.md"))

        assertEquals(docs, PartialPathRule.Content("docs").base(root, page, "a.mdoc").directory)
        // コンテンツのディレクトリがなければプロジェクトルート
        assertEquals(root, PartialPathRule.Content("missing").base(root, page, "a.mdoc").directory)

        assertEquals(page.parent, PartialPathRule.Relative.base(root, page, "./a.mdoc")?.directory)
        assertEquals(root, PartialPathRule.Relative.base(root, page, "/a.mdoc")?.directory)
    }

    /** [json] の設定エントリから選んだ規則。 */
    private fun rule(json: String) = PartialPathRule.from(JsonParser.parseString(json).asJsonObject)
}
