package net.plalis.markdoc.config.framework

import com.google.gson.JsonObject
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import net.plalis.markdoc.config.javascript.JavaScriptSource
import net.plalis.markdoc.config.javascript.JsBoolean
import net.plalis.markdoc.config.javascript.JsObject

/**
 * Astro（`@astrojs/markdoc`）のプロジェクト。
 *
 * Astro は `<!-- … -->` を常にコメントとして扱い（`allowComments`）、`ignoreIndentation`・`allowHTML` で
 * `allowIndentation` を有効にし、変数をページから `<Content />` に渡す（未定義の変数を報告しない）。
 */
object AstroFramework : MarkdocFramework() {
    /** エントリの `id`。 */
    override val id = "astro"

    /** 設定ファイルがないときの通知に添える文。 */
    override val notice = "This looks like an Astro project, so the config will be set up for @astrojs/markdoc."

    /** Astro の設定ファイルの名前。 */
    private val ASTRO_CONFIG_NAMES = listOf("mjs", "js", "ts", "mts", "cjs", "cts").map { "astro.config.$it" }

    /** スキーマのファイル名。先にあるものを優先する。 */
    private val MARKDOC_CONFIG_NAMES = listOf("mjs", "ts", "js", "mts").map { "markdoc.config.$it" }

    /** Markdoc のインテグレーションのパッケージ名。 */
    private const val INTEGRATION_PACKAGE = "@astrojs/markdoc"

    /** `true` なら `allowIndentation` を有効にする、インテグレーションの設定のキー。 */
    private val INDENTATION_OPTIONS = listOf("ignoreIndentation", "allowHTML")

    /** Astro の設定ファイルがあるか、依存に `@astrojs/markdoc` があれば真を返す。 */
    override fun detect(root: VirtualFile): Boolean =
        ASTRO_CONFIG_NAMES.any { root.findChild(it) != null } || dependsOn(root, INTEGRATION_PACKAGE)

    /** スキーマのファイルがなければ、`markdoc.config.mjs` を指すエントリを返す。 */
    override fun createEntry(root: VirtualFile): JsonObject = entry(root, schemaFile(root) ?: MARKDOC_CONFIG_NAMES.first())

    /** スキーマのファイルがなければ `null` を返す。 */
    override fun defaultEntry(root: VirtualFile): JsonObject? = schemaFile(root)?.let { entry(root, it) }

    /** [root] にあるスキーマのファイルの名前。なければ `null`。 */
    private fun schemaFile(root: VirtualFile): String? = MARKDOC_CONFIG_NAMES.firstOrNull { root.findChild(it) != null }

    /** スキーマのファイル [schemaPath] を読むエントリ。 */
    private fun entry(root: VirtualFile, schemaPath: String): JsonObject = JsonObject().apply {
        addProperty("id", id)
        addProperty("path", "src/content")
        add("schema", JsonObject().apply {
            addProperty("path", schemaPath)
            addProperty("type", "esm")
            addProperty("property", "default")
            addProperty("watch", true)
        })
        add("markdoc", JsonObject().apply {
            addProperty("allowComments", true)
            if (allowsIndentation(root)) addProperty("allowIndentation", true)
        })
        addProperty("partialPaths", "relative")
        addProperty("frontmatterVariable", "frontmatter")
        addProperty("ignoreUndefinedVariables", true)
    }

    /**
     * Astro の設定で、Markdoc のインテグレーションの呼び出し（`markdoc({ … })`）の引数に
     * `ignoreIndentation: true` か `allowHTML: true` があるか。
     */
    private fun allowsIndentation(root: VirtualFile): Boolean {
        val config = ASTRO_CONFIG_NAMES.firstNotNullOfOrNull { root.findChild(it) } ?: return false
        val text = try {
            VfsUtilCore.loadText(config)
        } catch (_: Exception) {
            return false
        }
        return allowsIndentation(text)
    }

    /**
     * JavaScript の [text] で、インテグレーションの呼び出しの最初の引数のオブジェクトに、値が `true` のリテラルの
     * `ignoreIndentation` か `allowHTML` があるか。`false` と、リテラルとして読めない値は有効にしない。
     *
     * @param text Astro の設定ファイルのテキスト
     * @return あれば真
     */
    internal fun allowsIndentation(text: String): Boolean {
        val source = JavaScriptSource(text)
        val name = source.defaultImportName(INTEGRATION_PACKAGE) ?: "markdoc"
        return source.firstArguments(name).any { options ->
            options is JsObject && INDENTATION_OPTIONS.any { options[it] == JsBoolean(true) }
        }
    }
}
