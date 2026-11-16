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
     * 残りが [targets] のどれかのディレクトリからの相対パス。`*` の別名で行き先が複数あれば、[targets] は書いた順に並ぶ。
     * `*` のない別名では [directory] がファイルで、[prefixLength] がパス全体の長さ。
     *
     * `*` の別名では、パスの最後の要素の末尾の [patternSuffix]（別名の `*` より後）を、ファイル名では行き先ごとの
     * [Target.suffix]（行き先の `*` より後）に読み替える（行き先が `src/partials/` に `*.mdoc` を続けたものなら、`a` は `a.mdoc`）。
     */
    data class Base(val targets: List<Target>, val prefixLength: Int = 0, val patternSuffix: String = "") {
        constructor(directory: VirtualFile, prefixLength: Int = 0) : this(listOf(Target(directory)), prefixLength)

        /** 最初の基準。 */
        val directory: VirtualFile get() = targets.first().directory

        /** パスの最後の要素 [name] が [target] で指すファイル名。別名の `*` より後が合わなければ `null`。 */
        fun fileName(target: Target, name: String): String? =
            if (name.endsWith(patternSuffix)) name.removeSuffix(patternSuffix) + target.suffix else null

        /** [target] のファイル名 [name] を、パスの最後の要素として書く名前。行き先の `*` より後が合わなければ `null`。 */
        fun pathName(target: Target, name: String): String? =
            if (name.endsWith(target.suffix)) name.removeSuffix(target.suffix) + patternSuffix else null
    }

    /** 別名の行き先のディレクトリ [directory] と、行き先の `*` より後 [suffix]（なければ空）。 */
    data class Target(val directory: VirtualFile, val suffix: String = "")

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
        val last = segmentEnd == text.length
        val target = base.targets.firstOrNull { find(base, it, text.trim('/'), last = true) != null }
        return target?.let { find(base, it, path, last) }
            ?: base.targets.firstNotNullOfOrNull { find(base, it, path, last) }
    }

    /**
     * [target] のディレクトリからの [path]。[last] ならパスの最後の要素をファイル名に読み替えて探し、
     * 読み替えたファイルがなければ書いたとおりの名前で探す。
     */
    private fun find(base: Base, target: Target, path: String, last: Boolean): VirtualFile? {
        if (last) {
            val name = path.substringAfterLast('/')
            val mapped = base.fileName(target, name)?.let { path.removeSuffix(name) + it }
            if (mapped != null && mapped != path) target.directory.findFileByRelativePath(mapped)?.let { return it }
        }
        return target.directory.findFileByRelativePath(path)
    }

    /** 設定の `path` のディレクトリ。なければプロジェクトルート。 */
    private fun contentRoot(root: VirtualFile, path: String?): VirtualFile {
        val relative = path.orEmpty().replace('\\', '/').trim('/')
        return relative.takeIf { it.isNotEmpty() }?.let(root::findFileByRelativePath) ?: root
    }

    /**
     * [text] に一致する tsconfig の別名の行き先。`*` 付きなら、行き先の `*` がファイル名の位置にあるもの（`src/partials/` に
     * `*` か `*.mdoc` を続けたもの）のうち存在するすべてのディレクトリ（ファイルは [resolveAt] と補完がそれぞれの行き先で探す）。
     * そうした行き先がなければ、それ以外の `*` 付きの行き先のうち存在する最初のファイル。`*` なしなら存在する最初の行き先のファイル。
     */
    private fun aliasBase(root: VirtualFile, text: String): Base? {
        for (alias in MarkdocTsconfigAliases.read(root)) {
            if (alias.wildcard && text.startsWith(alias.prefix)) {
                val targets = ArrayList<Target>()
                var file: VirtualFile? = null
                for (target in alias.targets) {
                    val star = target.indexOf('*')
                    val head = if (star < 0) target else target.substring(0, star)
                    val tail = if (star < 0) "" else target.substring(star + 1)
                    if (star >= 0 && (head.isEmpty() || head.endsWith('/')) && '/' !in tail) {
                        val path = head.trimEnd('/')
                        val directory = if (path.isEmpty()) alias.base else alias.base.findFileByRelativePath(path)
                        if (directory?.isDirectory == true) targets += Target(directory, tail)
                    } else if (file == null && text.length >= alias.prefix.length + alias.suffix.length &&
                        text.endsWith(alias.suffix)
                    ) {
                        // `*` が行き先のディレクトリの位置にあれば（`src/*/index.mdoc`）、パス全体をファイルに読み替える
                        val captured = text.substring(alias.prefix.length, text.length - alias.suffix.length)
                        file = alias.base.findFileByRelativePath(head + (if (star < 0) "" else captured) + tail)
                            ?.takeIf { !it.isDirectory }
                    }
                }
                if (targets.isNotEmpty()) return Base(targets, alias.prefix.length, alias.suffix)
                if (file != null) return Base(file, text.length)
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
