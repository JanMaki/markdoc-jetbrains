package net.plalis.markdoc.paths

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile

/**
 * `tsconfig.json` の `compilerOptions.paths` の別名（Astro は partial の `file` にも使える）。
 * 言語サーバーの `partials.js` と同じく、`extends` は相対パスのものだけたどる。
 */
object MarkdocTsconfigAliases {
    /** 別名。[prefix] は `*` より前（なければ全体）、[base] は継承を含む `baseUrl`（なければ `paths` を書いた tsconfig のディレクトリ）。 */
    data class Alias(val prefix: String, val wildcard: Boolean, val targets: List<String>, val base: VirtualFile)

    /** `extends` をたどる深さの上限（循環対策）。 */
    private const val MAX_DEPTH = 10

    /**
     * 継承を反映した設定。[paths] は書いた tsconfig のディレクトリ [pathsDirectory] と組にし、
     * [baseUrl] は書いた tsconfig から解決したディレクトリ。
     */
    private data class Options(
        val paths: JsonObject? = null,
        val pathsDirectory: VirtualFile? = null,
        val baseUrl: VirtualFile? = null,
    )

    /**
     * [root] の `tsconfig.json` の別名。`*` の前が長い（具体的な）ものから並べる。
     * 行き先は実際の（継承したものを含む）`baseUrl` から、なければ `paths` を書いた tsconfig のディレクトリから解決する。
     */
    fun read(root: VirtualFile): List<Alias> {
        val file = root.findChild("tsconfig.json") ?: return emptyList()
        val options = read(file, 0)
        val paths = options.paths ?: return emptyList()
        val base = options.baseUrl ?: options.pathsDirectory ?: return emptyList()
        return paths.entrySet().mapNotNull { (pattern, value) ->
            if (!value.isJsonArray) return@mapNotNull null
            val targets =
                value.asJsonArray.mapNotNull { it.takeIf { e -> e.isJsonPrimitive }?.asString?.removePrefix("./") }
            val star = pattern.indexOf('*')
            Alias(if (star < 0) pattern else pattern.substring(0, star), star >= 0, targets, base)
        }.sortedByDescending { it.prefix.length }
    }

    /** [file] の `paths` と `baseUrl`。後の `extends` ほど、子ほど優先する。 */
    private fun read(file: VirtualFile, depth: Int): Options {
        if (depth > MAX_DEPTH || file.isDirectory) return Options()
        val json = try {
            JsonParser.parseString(stripJsonc(VfsUtilCore.loadText(file))) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return Options()
        val directory = file.parent ?: return Options()

        var options = Options()
        val parents = json.get("extends")?.let { if (it.isJsonArray) it.asJsonArray.toList() else listOf(it) }.orEmpty()
        for (parent in parents) {
            val path = parent.takeIf { it.isJsonPrimitive }?.asString ?: continue
            if (!path.startsWith("./") && !path.startsWith("../")) continue
            val target =
                directory.findFileByRelativePath(if (path.endsWith(".json")) path else "$path.json") ?: continue
            val inherited = read(target, depth + 1)
            if (inherited.paths != null) {
                options = options.copy(paths = inherited.paths, pathsDirectory = inherited.pathsDirectory)
            }
            if (inherited.baseUrl != null) options = options.copy(baseUrl = inherited.baseUrl)
        }

        val compilerOptions = json.get("compilerOptions") as? JsonObject ?: return options
        (compilerOptions.get("paths") as? JsonObject)?.let {
            options = options.copy(paths = it, pathsDirectory = directory)
        }
        val baseUrl = compilerOptions.get("baseUrl")?.takeIf { it.isJsonPrimitive }?.asString
        if (baseUrl != null) {
            val relative = baseUrl.trimEnd('/').removePrefix("./").takeIf { it.isNotEmpty() && it != "." }
            options = options.copy(baseUrl = relative?.let { directory.findFileByRelativePath(it) } ?: directory)
        }
        return options
    }

    /** コメントと末尾のカンマを取り除く（tsconfig.json は JSONC）。 */
    fun stripJsonc(text: String): String {
        val output = StringBuilder(text.length)
        var i = 0
        var inString = false
        while (i < text.length) {
            val c = text[i]
            if (inString) {
                output.append(c)
                if (c == '\\' && i + 1 < text.length) output.append(text[++i])
                else if (c == '"') inString = false
                i++
                continue
            }
            when {
                c == '"' -> {
                    inString = true
                    output.append(c)
                    i++
                }

                c == '/' && text.getOrNull(i + 1) == '/' -> {
                    while (i < text.length && text[i] != '\n') i++
                }

                c == '/' && text.getOrNull(i + 1) == '*' -> {
                    i += 2
                    while (i < text.length && !(text[i] == '*' && text.getOrNull(i + 1) == '/')) i++
                    i += 2
                }

                else -> {
                    output.append(c)
                    i++
                }
            }
        }
        return TRAILING_COMMA.replace(output) { it.groupValues[1] }
    }

    /** 閉じ括弧の前のカンマ。 */
    private val TRAILING_COMMA = Regex(""",(\s*[}\]])""")
}
