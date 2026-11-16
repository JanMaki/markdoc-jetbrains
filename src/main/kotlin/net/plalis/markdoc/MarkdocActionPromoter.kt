package net.plalis.markdoc

import com.intellij.openapi.actionSystem.*
import net.plalis.markdoc.paths.MarkdocPathValue

/**
 * Markdoc ファイルのタグ（`{% … %}`）の中では、Ctrl+B を太字の切り替えではなく「宣言へ移動」にする。
 * 移動先は、パスなら [net.plalis.markdoc.paths.MarkdocPathGotoDeclarationHandler]、
 * それ以外は [net.plalis.markdoc.lsp.MarkdocLspGotoDeclarationHandler]（言語サーバーの定義ジャンプ）が返す。
 *
 * Markdown プラグインの `MarkdownActionPromoter` は Markdown ファイルで書式アクションを常に優先する。
 * プロモーターは後に適用されるものほど優先されるため、`order="last"` で登録する。
 */
class MarkdocActionPromoter : ActionPromoter {
    override fun promote(actions: List<AnAction>, context: DataContext): List<AnAction> {
        val editor = context.getData(CommonDataKeys.EDITOR) ?: return emptyList()
        val project = context.getData(CommonDataKeys.PROJECT) ?: return emptyList()
        val file = context.getData(CommonDataKeys.VIRTUAL_FILE) ?: return emptyList()
        if (!MarkdocFiles.isMarkdoc(file)) return emptyList()
        val text = editor.document.charsSequence
        val offset = editor.caretModel.offset
        val allowComments = MarkdocConfigReader.allowComments(project)
        // isInTagAt はフェンスの中を除くので、処理するフェンス（`process=false` なし）の中のタグのパスは別に確かめる。
        // MarkdocPathValue.at はタグの中のパスだけを返し、インラインコードと `process=false` のフェンスの中は除く
        if (!MarkdocTagScanner.isInTagAt(text, offset, allowComments) && MarkdocPathValue.at(text, offset) == null) {
            return emptyList()
        }
        val manager = ActionManager.getInstance()
        return actions.filter { manager.getId(it) == IdeActions.ACTION_GOTO_DECLARATION }
    }
}
