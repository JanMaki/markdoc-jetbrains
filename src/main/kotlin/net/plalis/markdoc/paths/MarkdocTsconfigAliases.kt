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
    /** 別名。[prefix] は `*` より前（なければ全体）、[base] は `baseUrl`（なければ tsconfig のディレクトリ）。 */
    data class Alias(val prefix: String, val wildcard: Boolean, val targets: List<String>, val base: VirtualFile)

    /** `extends` をたどる深さの上限（循環対策）。 */
    private const val MAX_DEPTH = 10

    /** [root] の `tsconfig.json` の別名。`*` の前が長い（具体的な）ものから並べる。 */
    fun read(root: VirtualFile): List<Alias> {
        val file = root.findChild("tsconfig.json") ?: return emptyList()
        return read(file, 0).sortedByDescending { it.prefix.length }
    }

    private fun read(file: VirtualFile, depth: Int): List<Alias> {
        if (depth > MAX_DEPTH || file.isDirectory) return emptyList()
        val json = try {
            JsonParser.parseString(stripJsonc(VfsUtilCore.loadText(file))) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return emptyList()
        val directory = file.parent ?: return emptyList()

        var inherited = emptyList<Alias>()
        val parents = json.get("extends")?.let { if (it.isJsonArray) it.asJsonArray.toList() else listOf(it) }.orEmpty()
        for (parent in parents) {
            val path = parent.takeIf { it.isJsonPrimitive }?.asString ?: continue
            if (!path.startsWith("./") && !path.startsWith("../")) continue
            val target =
                directory.findFileByRelativePath(if (path.endsWith(".json")) path else "$path.json") ?: continue
            inherited = read(target, depth + 1)
        }

        val options = json.get("compilerOptions") as? JsonObject ?: return inherited
        val paths = options.get("paths") as? JsonObject ?: return inherited
        val baseUrl = options.get("baseUrl")?.takeIf { it.isJsonPrimitive }?.asString
        val base = baseUrl?.trimEnd('/')?.removePrefix("./")?.takeIf { it.isNotEmpty() && it != "." }
            ?.let { directory.findFileByRelativePath(it) } ?: directory
        return paths.entrySet().mapNotNull { (pattern, value) ->
            if (!value.isJsonArray) return@mapNotNull null
            val targets =
                value.asJsonArray.mapNotNull { it.takeIf { e -> e.isJsonPrimitive }?.asString?.removePrefix("./") }
            val star = pattern.indexOf('*')
            Alias(if (star < 0) pattern else pattern.substring(0, star), star >= 0, targets, base)
        }
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
