package net.plalis.markdoc.config.framework

import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile

/**
 * Markdoc を使うフレームワークの判定と、そのフレームワークに合わせた `markdoc.config.json` のエントリ。
 *
 * フレームワークごとの違いはサブクラスに置き、設定ファイルの雛形、設定ファイルがないときの設定、通知の文言は
 * [of] で選んだサブクラスから得る。
 */
abstract class MarkdocFramework {
    /** エントリの `id` に書く名前。 */
    abstract val id: String

    /** 設定ファイルがないときの通知に添える文。 */
    abstract val notice: String

    /**
     * [root] のプロジェクトがこのフレームワークを使っているか。
     *
     * @param root プロジェクトルート
     * @return 使っていれば真
     */
    abstract fun detect(root: VirtualFile): Boolean

    /**
     * 設定ファイルの雛形に書くエントリ。
     *
     * @param root プロジェクトルート
     * @return エントリ（`root` は含めない）
     */
    protected abstract fun createEntry(root: VirtualFile): JsonObject

    /**
     * 設定ファイルがないときにサーバーへ渡すエントリ。
     *
     * @param root プロジェクトルート
     * @return エントリ（`root` は含めない）。このフレームワークの設定で起動しない場合は `null`
     */
    open fun defaultEntry(root: VirtualFile): JsonObject? = createEntry(root)

    /**
     * 設定ファイルを作るときの中身（エントリ 1 件の配列。末尾は改行）。
     *
     * @param root プロジェクトルート
     * @return 設定ファイルの中身
     */
    fun templateText(root: VirtualFile): String = GSON.toJson(JsonArray().apply { add(createEntry(root)) }) + "\n"

    /**
     * [root] の `package.json` の `dependencies`・`devDependencies`・`peerDependencies` に [name] があるか。
     *
     * @param root プロジェクトルート
     * @param name パッケージ名
     * @return あれば真。`package.json` がないか読めなければ偽
     */
    protected fun dependsOn(root: VirtualFile, name: String): Boolean {
        val file = root.findChild("package.json") ?: return false
        val json = try {
            JsonParser.parseString(VfsUtilCore.loadText(file)) as? JsonObject
        } catch (_: Exception) {
            null
        } ?: return false
        return listOf("dependencies", "devDependencies", "peerDependencies").any {
            (json.get(it) as? JsonObject)?.has(name) == true
        }
    }

    companion object {
        /**
         * 判定する順に並べたフレームワーク。
         *
         * サブクラスを先に初期化すると、その途中でこのクラスも初期化され、その時点ではサブクラスのインスタンスが
         * まだ `null` になる。そのため、初めて使うときに作る。
         */
        val ALL: List<MarkdocFramework> by lazy { listOf(AstroFramework) }

        /** 雛形を書き出す Gson（字下げあり、HTML の文字をエスケープしない）。 */
        private val GSON = GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create()

        /**
         * [root] のプロジェクトが使うフレームワーク。
         *
         * @param root プロジェクトルート
         * @return [ALL] のうち最初に当てはまるもの。なければ `null`
         */
        fun of(root: VirtualFile): MarkdocFramework? = ALL.firstOrNull { it.detect(root) }

        /**
         * [project] が使うフレームワーク。
         *
         * @param project 対象のプロジェクト
         * @return [ALL] のうち最初に当てはまるもの。プロジェクトルートがないか、当てはまるものがなければ `null`
         */
        fun of(project: Project): MarkdocFramework? = project.guessProjectDir()?.let(::of)
    }
}
