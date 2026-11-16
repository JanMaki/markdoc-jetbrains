package net.plalis.markdoc.config

import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile

/**
 * Astro（`@astrojs/markdoc`）のプロジェクトの判定と、Astro に合わせた設定エントリ。
 *
 * Astro は `<!-- … -->` を常にコメントとして扱い（`allowComments`）、`ignoreIndentation`・`allowHTML` で
 * `allowIndentation` を有効にし、変数をページから `<Content />` に渡す（未定義の変数を報告しない）。
 */
object MarkdocAstroProject {
    private val ASTRO_CONFIG_NAMES = listOf("mjs", "js", "ts", "mts", "cjs", "cts").map { "astro.config.$it" }

    /** スキーマのファイル名。先にあるものを優先する。 */
    private val MARKDOC_CONFIG_NAMES = listOf("mjs", "ts", "js", "mts").map { "markdoc.config.$it" }

    private const val INTEGRATION_PACKAGE = "@astrojs/markdoc"

    /** Astro の設定ファイルか、依存に `@astrojs/markdoc` があるか。 */
    fun isAstro(project: Project): Boolean = project.guessProjectDir()?.let(::isAstro) == true

    fun isAstro(root: VirtualFile): Boolean =
        ASTRO_CONFIG_NAMES.any { root.findChild(it) != null } || dependsOnIntegration(root)

    /** Astro 向けの `markdoc.config.json` の中身。 */
    fun templateText(root: VirtualFile): String =
        GSON.toJson(JsonArray().apply { add(entry(root, schemaFile(root) ?: MARKDOC_CONFIG_NAMES.first())) }) + "\n"

    /** 設定ファイルがないときの設定エントリ。Astro のプロジェクトでスキーマがなければ `null`。 */
    fun defaultEntry(root: VirtualFile): JsonObject? {
        val schema = schemaFile(root) ?: return null
        return if (isAstro(root)) entry(root, schema) else null
    }

    private fun schemaFile(root: VirtualFile): String? = MARKDOC_CONFIG_NAMES.firstOrNull { root.findChild(it) != null }

    private fun entry(root: VirtualFile, schemaPath: String): JsonObject = JsonObject().apply {
        addProperty("id", "astro")
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

    /** Astro の設定に `ignoreIndentation: true` か `allowHTML: true` があるか（JavaScript なので文字列で探す）。 */
    private fun allowsIndentation(root: VirtualFile): Boolean {
        val config = ASTRO_CONFIG_NAMES.firstNotNullOfOrNull { root.findChild(it) } ?: return false
        val text = try {
            VfsUtilCore.loadText(config)
        } catch (_: Exception) {
            return false
        }
        return INDENTATION_OPTION.containsMatchIn(text)
    }

    private fun dependsOnIntegration(root: VirtualFile): Boolean {
        val file = root.findChild("package.json") ?: return false
        val json = try {
            JsonParser.parseString(VfsUtilCore.loadText(file)) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return false
        return listOf("dependencies", "devDependencies", "peerDependencies").any {
            (json.get(it) as? JsonObject)?.has(INTEGRATION_PACKAGE) == true
        }
    }

    private val GSON = GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create()

    private val INDENTATION_OPTION = Regex("""\b(ignoreIndentation|allowHTML)\s*:\s*true\b""")
}
