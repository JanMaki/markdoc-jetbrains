package net.plalis.markdoc

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VirtualFile

/**
 * 設定の `contentPaths` と `markdocExtensions` で Markdoc ファイルとして扱う範囲。
 *
 * コンテンツのディレクトリ（`contentPaths`、なければ `path`）の中で、`markdocExtensions` の拡張子を持つファイルが範囲に入る。
 * 言語サーバーの Scanner と同じく、`node_modules`・`.next`・`.git` の中は除く。
 * `.mdoc` などの拡張子による判定（[MarkdocFiles]）とは別に使う。
 *
 * @param directories コンテンツのディレクトリの絶対パス（`/` 区切り）
 * @param extensions 小文字の拡張子（`.md` など）
 */
class MarkdocFileScope private constructor(
    private val directories: List<String>,
    private val extensions: List<String>,
) {
    /**
     * [file] が範囲に入るか。
     *
     * @param file 調べるファイル
     * @return 入れば真。ディレクトリは偽
     */
    fun contains(file: VirtualFile): Boolean {
        if (file.isDirectory || extensions.isEmpty()) return false
        val name = file.name.lowercase()
        if (extensions.none { name.endsWith(it) }) return false
        val path = file.path
        return directories.any { directory ->
            FileUtil.isAncestor(directory, path, true) &&
                    FileUtil.getRelativePath(directory, path, '/')
                        ?.split('/')
                        ?.dropLast(1)
                        ?.none { it in SKIPPED_DIRECTORIES } == true
        }
    }

    companion object {
        /** 何も含まない範囲。 */
        val EMPTY = MarkdocFileScope(emptyList(), emptyList())

        /** 中を範囲に含めないディレクトリの名前（言語サーバーの scanner.js と同じ）。 */
        private val SKIPPED_DIRECTORIES = setOf("node_modules", ".next", ".git")

        /**
         * 設定エントリ [config] の範囲。
         *
         * `contentPaths` の文字列のうちプロジェクトルートの中を指すものをコンテンツのディレクトリにし、なければ `path` を使う。
         * `markdocExtensions` の文字列は小文字にし、先頭に `.` がなければ付ける。
         *
         * @param root プロジェクトルート
         * @param config 設定エントリ。`null` なら [EMPTY]
         * @return 範囲
         */
        fun of(root: VirtualFile, config: JsonObject?): MarkdocFileScope {
            if (config == null) return EMPTY
            val extensions = strings(config.get("markdocExtensions"))
                .map { it.trim().lowercase() }
                .filter { it.isNotEmpty() && it != "." }
                .map { if (it.startsWith(".")) it else ".$it" }
            if (extensions.isEmpty()) return EMPTY
            val rootPath = FileUtil.toSystemIndependentName(root.path).trimEnd('/')
            val inside = { relative: String -> resolve(rootPath, relative)?.takeIf { FileUtil.isAncestor(rootPath, it, false) } }
            val directories = strings(config.get("contentPaths")).mapNotNull(inside)
                .ifEmpty { listOfNotNull(inside(pathOf(config))) }
            return MarkdocFileScope(directories, extensions)
        }

        /** 設定の `path`。文字列でなければ `""`（プロジェクトルート）。 */
        private fun pathOf(config: JsonObject): String =
            (config.get("path") as? JsonPrimitive)?.takeIf { it.isString }?.asString ?: ""

        /** [element] が配列なら、その中の文字列。 */
        private fun strings(element: Any?): List<String> =
            (element as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.asString }.orEmpty()

        /** [rootPath] からの [relative] を正規化した絶対パス。絶対パスなら `null`。 */
        private fun resolve(rootPath: String, relative: String): String? {
            val normalized = FileUtil.toSystemIndependentName(relative)
            if (normalized.startsWith("/") || FileUtil.isAbsolute(normalized)) return null
            return FileUtil.toCanonicalPath("$rootPath/$normalized").trimEnd('/')
        }
    }
}
