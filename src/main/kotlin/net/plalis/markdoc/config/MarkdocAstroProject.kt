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
     * JavaScript の [text] で、インテグレーションの呼び出しの引数に `ignoreIndentation` か `allowHTML` を
     * `true` にしたプロパティ（キーは引用符の有無を問わない）があるか。コメントと文字列の中身は見ない。
     */
    internal fun allowsIndentation(text: String): Boolean {
        val name = INTEGRATION_IMPORT.find(stripJavaScript(text, keepStrings = true))?.groupValues?.get(1) ?: "markdoc"
        val code = stripJavaScript(text, keepStrings = false)
        val call = Regex("""(?<![\w$.])${Regex.escape(name)}\s*\(""")
        return call.findAll(code).any { match ->
            val open = match.range.last
            INDENTATION_OPTION.containsMatchIn(code.substring(open, closingParen(code, open)))
        }
    }

    /** [open] の `(` に対応する `)` の位置。閉じていなければ末尾。文字列とコメントは除いてあるものとする。 */
    private fun closingParen(code: String, open: Int): Int {
        var depth = 0
        for (i in open until code.length) {
            when (code[i]) {
                '(', '[', '{' -> depth++
                ')', ']', '}' -> if (--depth == 0) return i
            }
        }
        return code.length
    }

    /**
     * JavaScript の [text] からコメントを除く。[keepStrings] が偽なら文字列を空の `""` にし、
     * プロパティのキーの文字列（直後に `:` が続く）は引用符を外して中身だけ残す。
     */
    private fun stripJavaScript(text: String, keepStrings: Boolean): String {
        val output = StringBuilder(text.length)
        var i = 0
        while (i < text.length) {
            val c = text[i]
            when {
                c == '/' && text.getOrNull(i + 1) == '/' -> while (i < text.length && text[i] != '\n') i++
                c == '/' && text.getOrNull(i + 1) == '*' -> {
                    val end = text.indexOf("*/", i + 2)
                    i = if (end < 0) text.length else end + 2
                    output.append(' ')
                }

                c == '"' || c == '\'' || c == '`' -> {
                    var j = i + 1
                    while (j < text.length && text[j] != c) j += if (text[j] == '\\') 2 else 1
                    val end = minOf(j + 1, text.length)
                    var next = end
                    while (next < text.length && text[next].isWhitespace()) next++
                    output.append(
                        when {
                            keepStrings -> text.substring(i, end)
                            c != '`' && text.getOrNull(next) == ':' -> text.substring(i + 1, minOf(j, text.length))
                            else -> "\"\""
                        }
                    )
                    i = end
                }

                else -> {
                    output.append(c)
                    i++
                }
            }
        }
        return output.toString()
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

    /** 値が `true` の `ignoreIndentation`・`allowHTML`（キーの引用符は [stripJavaScript] で外してある）。 */
    private val INDENTATION_OPTION = Regex("""(?<![\w$.])(ignoreIndentation|allowHTML)\s*:\s*true(?![\w$])""")

    /** `@astrojs/markdoc` の既定のインポートの名前。 */
    private val INTEGRATION_IMPORT =
        Regex("""\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']@astrojs/markdoc["']""")
}
