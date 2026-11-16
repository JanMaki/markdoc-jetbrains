package net.plalis.markdoc

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.psi.util.CachedValue
import com.intellij.psi.util.CachedValueProvider
import com.intellij.psi.util.CachedValuesManager

/**
 * プロジェクトの設定（[MarkdocConfigReader.effectiveConfig]）から作る値を、設定ファイルが変わるまでキャッシュする。
 *
 * 色分けや入力補助のように頻繁に呼ばれる処理が、毎回設定ファイルを読まないようにする。
 * 設定ファイルの追加・削除・名前の変更でも読み直せるように、ファイルの構造の変更
 * （[VirtualFileManager.VFS_STRUCTURE_MODIFICATIONS]）でも捨てる。
 */
@Service(Service.Level.PROJECT)
class MarkdocProjectConfig(private val project: Project) {
    /** 設定の `contentPaths`・`markdocExtensions` で Markdoc ファイルとして扱う範囲。 */
    private val fileScope: CachedValue<MarkdocFileScope> =
        CachedValuesManager.getManager(project).createCachedValue {
            val root = project.guessProjectDir()
            val scope = root?.let { MarkdocFileScope.of(it, MarkdocConfigReader.effectiveConfig(project)) }
            val dependencies = listOfNotNull(
                MarkdocConfigReader.findConfigFile(project),
                VirtualFileManager.VFS_STRUCTURE_MODIFICATIONS,
            )
            CachedValueProvider.Result.create(scope ?: MarkdocFileScope.EMPTY, *dependencies.toTypedArray())
        }

    /**
     * 設定の `contentPaths`・`markdocExtensions` で Markdoc ファイルとして扱う範囲。
     *
     * @return 範囲。設定ファイルがなければ [MarkdocConfigReader.defaultConfig] の範囲、読めなければ [MarkdocFileScope.EMPTY]
     */
    fun fileScope(): MarkdocFileScope = fileScope.value

    companion object {
        /**
         * [project] のサービスを返す。
         *
         * @param project 対象のプロジェクト
         * @return サービス
         */
        fun getInstance(project: Project): MarkdocProjectConfig = project.service()
    }
}
