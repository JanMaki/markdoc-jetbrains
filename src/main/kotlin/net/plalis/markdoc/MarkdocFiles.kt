package net.plalis.markdoc

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Markdoc として扱うファイルの判定。
 *
 * 言語サーバーの対象判定、色分け、入力補助など、ファイルの種類を見る処理はすべてここを通す。
 * ファイルタイプの関連付けは plugin.xml の拡張子で行う。
 */
object MarkdocFiles {
    /** 場所によらず Markdoc ファイルとみなす拡張子。公式 VS Code 拡張が認識するものと同じ。 */
    private val SUFFIXES = listOf(".mdoc", ".markdoc", ".markdoc.md")

    /**
     * [project] で [file] を Markdoc ファイルとして扱うか。
     *
     * `.mdoc`・`.markdoc`・`*.markdoc.md` はどこにあっても Markdoc ファイルとし、ほかは設定の `contentPaths`・
     * `markdocExtensions` の範囲（[MarkdocFileScope]）に入るときだけ Markdoc ファイルとする。
     *
     * @param project ファイルを開いているプロジェクト
     * @param file 調べるファイル
     * @return Markdoc ファイルなら真。ディレクトリは偽
     */
    fun isMarkdoc(project: Project, file: VirtualFile): Boolean {
        if (file.isDirectory) return false
        if (hasMarkdocSuffix(file)) return true
        if (project.isDisposed) return false
        return MarkdocProjectConfig.getInstance(project).fileScope().contains(file)
    }

    /**
     * [file] の名前の末尾が、場所によらず Markdoc ファイルとみなす拡張子か。大文字の拡張子（`Guide.MDOC`）も含む。
     *
     * @param file 調べるファイル
     * @return そうなら真
     */
    private fun hasMarkdocSuffix(file: VirtualFile): Boolean {
        val name = file.name.lowercase()
        return SUFFIXES.any { name.endsWith(it) }
    }
}
