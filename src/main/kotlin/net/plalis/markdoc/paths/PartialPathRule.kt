package net.plalis.markdoc.paths

import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import net.plalis.markdoc.paths.MarkdocPathResolver.Base

/**
 * partial の `file` の基準を決める規則。設定の `partialPaths` で選ぶ（言語サーバーの `partials.js` の規則と同じ）。
 */
sealed interface PartialPathRule {
    /**
     * [file] に書かれた partial の `file` の値 [text] の基準。
     *
     * @param root プロジェクトルート
     * @param file partial を書いたファイル
     * @param text partial の `file` の値
     * @return 基準。決まらなければ `null`
     */
    fun base(root: VirtualFile, file: VirtualFile, text: String): Base?

    /**
     * `"content"`（既定）：コンテンツのディレクトリ（設定の `path`）から。ディレクトリがなければプロジェクトルートから。
     *
     * @property path 設定の `path`
     */
    data class Content(val path: String?) : PartialPathRule {
        override fun base(root: VirtualFile, file: VirtualFile, text: String): Base =
            Base(MarkdocPathResolver.findUnder(root, path) ?: root)
    }

    /**
     * `"relative"`：Astro と同じ。`./`・`../` と別名でない名前は書いたファイルから、`/` はプロジェクトルートから、
     * tsconfig の `paths` の別名はその行き先から。
     */
    data object Relative : PartialPathRule {
        override fun base(root: VirtualFile, file: VirtualFile, text: String): Base? = when {
            text.startsWith("./") || text.startsWith("../") -> null
            text.startsWith("/") -> Base(root)
            else -> MarkdocPathResolver.aliasBase(root, text)
        } ?: file.parent?.let { Base(it) }
    }

    /**
     * `{"directory": "…"}`：指定したディレクトリ（プロジェクトルートからのパス）から。先頭の `/` もそのディレクトリから。
     * 言語サーバーと同じく、ディレクトリがプロジェクトルートの外なら基準にしない。
     *
     * @property path 設定の `partialPaths.directory`
     */
    data class Directory(val path: String) : PartialPathRule {
        override fun base(root: VirtualFile, file: VirtualFile, text: String): Base? =
            MarkdocPathResolver.findUnder(root, path)
                ?.takeIf { it.isDirectory && VfsUtilCore.isAncestor(root, it, false) }
                ?.let { Base(it) }
    }

    companion object {
        /**
         * 設定エントリ [config] の `partialPaths` に合う規則。`"relative"` なら [Relative]、`directory` が文字列の
         * オブジェクトなら [Directory]、ほかは [Content]。
         *
         * @param config 設定エントリ。`null` なら [Content]（プロジェクトルートから）
         * @return 規則
         */
        fun from(config: JsonObject?): PartialPathRule {
            val value = config?.get("partialPaths")
            val directory = ((value as? JsonObject)?.get("directory") as? JsonPrimitive)?.takeIf { it.isString }
            return when {
                value is JsonPrimitive && value.asString == "relative" -> Relative
                directory != null -> Directory(directory.asString)
                else -> Content(config?.get("path")?.takeIf { it.isJsonPrimitive }?.asString)
            }
        }
    }
}
