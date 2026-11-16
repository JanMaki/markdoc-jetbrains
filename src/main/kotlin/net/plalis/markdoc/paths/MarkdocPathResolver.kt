package net.plalis.markdoc.paths

import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VirtualFile
import net.plalis.markdoc.MarkdocConfigReader

/**
 * 属性値のファイルパスを、プロジェクト内のファイルやディレクトリに結び付ける。
 *
 * - `partial` の `file`：言語サーバーの `partials.js` と同じ規則（設定の `partialPaths`）
 * - それ以外で `/` から始まるパス：プロジェクトルートから
 * - それ以外：パスを書いたファイルのディレクトリから
 */
object MarkdocPathResolver {
    /**
     * パスの基準。[prefixLength] はパスの先頭のうち基準を選ぶのに使った部分（別名 `@partials/`）の長さで、
     * 残りが [directories] のどれかからの相対パス。`*` の別名で行き先が複数あれば、[directories] は書いた順に並ぶ。
     * `*` のない別名では [directory] がファイルで、[prefixLength] がパス全体の長さ。
     */
    data class Base(val directories: List<VirtualFile>, val prefixLength: Int = 0) {
        constructor(directory: VirtualFile, prefixLength: Int = 0) : this(listOf(directory), prefixLength)

        /** 最初の基準。 */
        val directory: VirtualFile get() = directories.first()
    }

    /** [file] に書かれた [value] の基準。 */
    fun base(project: Project, file: VirtualFile, value: MarkdocPathValue): Base? {
        val root = project.guessProjectDir() ?: return null
        if (!value.isPartial) return Base(if (value.text.startsWith("/")) root else file.parent ?: return null)
        val config = MarkdocConfigReader.effectiveConfig(project)
        if (config?.get("partialPaths")?.takeIf { it.isJsonPrimitive }?.asString != "relative") {
            return Base(contentRoot(root, config?.get("path")?.takeIf { it.isJsonPrimitive }?.asString))
        }
        val text = value.text
        return when {
            text.startsWith("./") || text.startsWith("../") -> null
            text.startsWith("/") -> Base(root)
            else -> aliasBase(root, text)
        } ?: file.parent?.let { Base(it) }
    }

    /**
     * [value] のうち、[offset] がある区切りの末尾までのパスが指すファイルかディレクトリ。
     * `partials/footer.mdoc` の `partials` の上ならディレクトリ、`footer.mdoc` の上ならファイル。
     */
    fun resolveAt(project: Project, file: VirtualFile, value: MarkdocPathValue, offset: Int): VirtualFile? {
        val base = base(project, file, value) ?: return null
        if (!base.directory.isDirectory) return base.directory
        val local = offset - value.start - base.prefixLength
        if (local < 0) return null
        val text = value.text.substring(base.prefixLength)
        val segmentEnd = text.indexOf('/', local).takeIf { it >= 0 } ?: text.length
        val path = text.substring(0, segmentEnd).trim('/')
        if (path.isEmpty()) return null
        // 行き先が複数あれば、パス全体があるものを選ぶ（なければ区切りまでのパスがある最初のもの）
        val full = text.trim('/')
        val directory = base.directories.firstOrNull { it.findFileByRelativePath(full) != null }
        return directory?.findFileByRelativePath(path)
            ?: base.directories.firstNotNullOfOrNull { it.findFileByRelativePath(path) }
    }

    /** 設定の `path` のディレクトリ。なければプロジェクトルート。 */
    private fun contentRoot(root: VirtualFile, path: String?): VirtualFile {
        val relative = path.orEmpty().replace('\\', '/').trim('/')
        return relative.takeIf { it.isNotEmpty() }?.let(root::findFileByRelativePath) ?: root
    }

    /**
     * [text] に一致する tsconfig の別名の行き先。`*` 付きなら存在するすべての行き先のディレクトリ（ファイルは
     * [resolveAt] と補完がそれぞれの行き先で探す）、`*` なしなら存在する最初の行き先のファイル。
     */
    private fun aliasBase(root: VirtualFile, text: String): Base? {
        for (alias in MarkdocTsconfigAliases.read(root)) {
            if (alias.wildcard && text.startsWith(alias.prefix)) {
                val directories = alias.targets.filter { it.endsWith("/*") }.mapNotNull { target ->
                    alias.base.findFileByRelativePath(target.removeSuffix("/*"))?.takeIf { it.isDirectory }
                }
                if (directories.isNotEmpty()) return Base(directories, alias.prefix.length)
            } else if (!alias.wildcard && text == alias.prefix) {
                val file = alias.targets.firstNotNullOfOrNull { target ->
                    alias.base.findFileByRelativePath(target)?.takeIf { !it.isDirectory }
                }
                if (file != null) return Base(file, text.length)
            }
        }
        return null
    }
}
