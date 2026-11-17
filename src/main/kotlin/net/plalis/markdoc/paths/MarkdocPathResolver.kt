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
     * `*` の別名では、パスの末尾の [patternSuffix]（別名の `*` より後。`/` を含みうる）を、ファイルでは行き先ごとの
     * [Target.suffix]（行き先の `*` より後）に読み替える（行き先が `src/partials/` に `*.mdoc` を続けたものなら、`a` は `a.mdoc`）。
     */
    data class Base(val targets: List<Target>, val prefixLength: Int = 0, val patternSuffix: String = "") {
        constructor(directory: VirtualFile, prefixLength: Int = 0) : this(listOf(Target(directory)), prefixLength)

        /** 最初の基準。 */
        val directory: VirtualFile get() = targets.first().directory

        /** パス全体 [path] が [target] で指すファイルのパス。別名の `*` より後が合わなければ `null`。 */
        fun filePath(target: Target, path: String): String? =
            if (path.endsWith(patternSuffix)) path.removeSuffix(patternSuffix) + target.suffix else null

        /** [path] のうち、ファイル名に読み替える最後の要素の先頭（[patternSuffix] を除いた残りの最後の要素）。 */
        fun fileNameStart(path: String): Int {
            val stemEnd = if (path.endsWith(patternSuffix)) path.length - patternSuffix.length else path.length
            return path.lastIndexOf('/', stemEnd - 1) + 1
        }

        /** [target] のファイル名 [name] を、パスの最後の要素として書く名前。行き先の `*` より後が合わなければ `null`。 */
        fun pathName(target: Target, name: String): String? =
            if (name.endsWith(target.suffix)) name.removeSuffix(target.suffix) + patternSuffix else null
    }

    /** 別名の行き先のディレクトリ [directory] と、行き先の `*` より後 [suffix]（なければ空）。 */
    data class Target(val directory: VirtualFile, val suffix: String = "")

    /**
     * [file] に書かれた [value] の基準。partial の `file` は、設定の `partialPaths` で選んだ [PartialPathRule] で決める。
     *
     * @param project 対象のプロジェクト
     * @param file パスを書いたファイル
     * @param value 属性値のパス
     * @return 基準。決まらなければ `null`
     */
    fun base(project: Project, file: VirtualFile, value: MarkdocPathValue): Base? {
        val root = project.guessProjectDir() ?: return null
        if (!value.isPartial) return Base(if (value.text.startsWith("/")) root else file.parent ?: return null)
        return PartialPathRule.from(MarkdocConfigReader.effectiveConfig(project)).base(root, file, value.text)
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
        // ファイル名の要素（`*` の別名の `/` を含む末尾を合わせたもの）の上なら、パス全体をファイルとして探す
        val last = local >= base.fileNameStart(text)
        val segmentEnd = if (last) text.length else text.indexOf('/', local).takeIf { it >= 0 } ?: text.length
        val path = text.substring(0, segmentEnd).trim('/')
        if (path.isEmpty()) return null
        // 行き先が複数あれば、パス全体があるものを選ぶ（なければ区切りまでのパスがある最初のもの）
        val target = base.targets.firstOrNull { find(base, it, text.trim('/'), last = true) != null }
        return target?.let { find(base, it, path, last) }
            ?: base.targets.firstNotNullOfOrNull { find(base, it, path, last) }
    }

    /**
     * [target] のディレクトリからの [path]。[last] ならパス全体をファイルのパスに読み替えて探す
     * （読み替えたファイルがなければ、書いたとおりのパスは探さない）。読み替えられなければ書いたとおりのパスで探す。
     */
    private fun find(base: Base, target: Target, path: String, last: Boolean): VirtualFile? {
        val mapped = if (last) base.filePath(target, path) ?: path else path
        return target.directory.findFileByRelativePath(mapped)
    }

    /**
     * [root] からの [path] のディレクトリ。
     *
     * @param root プロジェクトルート
     * @param path プロジェクトルートからのパス（区切りは `/` か `\`）。空か `null` ならプロジェクトルート
     * @return ディレクトリかファイル。なければ `null`
     */
    internal fun findUnder(root: VirtualFile, path: String?): VirtualFile? {
        val relative = path.orEmpty().replace('\\', '/').trim('/')
        return if (relative.isEmpty()) root else root.findFileByRelativePath(relative)
    }

    /**
     * [text] に一致する tsconfig の別名の行き先。`*` 付きなら、行き先の `*` がファイル名の位置にあるもの（`src/partials/` に
     * `*` か `*.mdoc` を続けたもの）のうち存在するすべてのディレクトリ（ファイルは [resolveAt] と補完がそれぞれの行き先で探す）。
     * ただし、それ以外の `*` 付きの行き先のファイルが存在し、それより先の行き先にパス全体のファイルがなければそのファイル。
     * `*` なしなら存在する最初の行き先のファイル。
     */
    internal fun aliasBase(root: VirtualFile, text: String): Base? {
        for (alias in MarkdocTsconfigAliases.read(root)) {
            if (alias.wildcard && text.startsWith(alias.prefix)) {
                val targets = ArrayList<Target>()
                val rest = text.substring(alias.prefix.length).trim('/')
                for (target in alias.targets) {
                    val star = target.indexOf('*')
                    val head = if (star < 0) target else target.substring(0, star)
                    val tail = if (star < 0) "" else target.substring(star + 1)
                    if (star >= 0 && (head.isEmpty() || head.endsWith('/')) && '/' !in tail) {
                        val path = head.trimEnd('/')
                        val directory = if (path.isEmpty()) alias.base else alias.base.findFileByRelativePath(path)
                        if (directory?.isDirectory == true) targets += Target(directory, tail)
                    } else if (text.length >= alias.prefix.length + alias.suffix.length && text.endsWith(alias.suffix)) {
                        // `*` が行き先のディレクトリの位置にあれば（`src/*/index.mdoc`）、パス全体をファイルに読み替える
                        val captured = text.substring(alias.prefix.length, text.length - alias.suffix.length)
                        val file = alias.base.findFileByRelativePath(head + (if (star < 0) "" else captured) + tail)
                            ?.takeIf { !it.isDirectory } ?: continue
                        // 先の行き先にパス全体のファイルがなければ、この行き先のファイルを選ぶ
                        val earlier = Base(targets, alias.prefix.length, alias.suffix)
                        if (targets.none { find(earlier, it, rest, last = true)?.isDirectory == false }) {
                            return Base(file, text.length)
                        }
                    }
                }
                if (targets.isNotEmpty()) return Base(targets, alias.prefix.length, alias.suffix)
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
