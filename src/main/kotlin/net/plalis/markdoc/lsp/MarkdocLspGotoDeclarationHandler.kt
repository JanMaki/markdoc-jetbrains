package net.plalis.markdoc.lsp

import com.intellij.codeInsight.navigation.actions.GotoDeclarationHandler
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.platform.lsp.api.LspClient
import com.intellij.platform.lsp.api.LspClientManager
import com.intellij.platform.lsp.api.LspServerState
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiManager
import net.plalis.markdoc.MarkdocConfigReader
import net.plalis.markdoc.MarkdocFiles
import net.plalis.markdoc.MarkdocTagScanner
import net.plalis.markdoc.paths.MarkdocPathValue
import org.eclipse.lsp4j.DefinitionParams
import org.eclipse.lsp4j.Position

/**
 * タグの中の「宣言へ移動」を言語サーバーの定義ジャンプで行う。
 *
 * IDE の LSP の定義ジャンプは PSI の参照がない場所でしか働かず、Markdown の見出し（それ自体が宣言）の中では
 * 使われないため、`order="first"` で先に問い合わせる。パスは [net.plalis.markdoc.paths.MarkdocPathGotoDeclarationHandler] が扱う。
 */
class MarkdocLspGotoDeclarationHandler : GotoDeclarationHandler {
    override fun getGotoDeclarationTargets(sourceElement: PsiElement?, offset: Int, editor: Editor): Array<PsiElement>? {
        val psiFile = sourceElement?.containingFile ?: return null
        val file = psiFile.virtualFile ?: return null
        if (!MarkdocFiles.isMarkdoc(file)) return null
        val project = psiFile.project
        val document = editor.document
        val text = document.charsSequence
        val allowComments = MarkdocConfigReader.allowComments(project)
        if (!MarkdocTagScanner.isInTagAt(text, offset, allowComments)) return null
        if (MarkdocPathValue.at(text, offset, allowComments) != null) return null

        val client = LspClientManager.getInstance(project).getClients(MarkdocLspIntegrationProvider::class.java)
            .firstOrNull { it.state == LspServerState.Running } ?: return null
        val line = document.getLineNumber(offset)
        val params = DefinitionParams(
            client.getDocumentIdentifier(file),
            Position(line, offset - document.getLineStartOffset(line)),
        )
        val result = try {
            client.sendRequestSync(TIMEOUT_MS) { it.textDocumentService.definition(params) }
        } catch (e: ProcessCanceledException) {
            throw e
        } catch (e: Exception) {
            thisLogger().info("Markdoc definition request failed", e)
            null
        } ?: return null

        val locations = if (result.isLeft) {
            result.left.map { it.uri to it.range.start }
        } else {
            result.right.map { it.targetUri to it.targetSelectionRange.start }
        }
        val psiManager = PsiManager.getInstance(project)
        return locations.mapNotNull { (uri, start) -> target(client, psiManager, uri, start) }
            .toTypedArray()
            .takeIf { it.isNotEmpty() }
    }

    /** [uri] の [start] の位置の要素。要素がなければファイル。 */
    private fun target(client: LspClient, psiManager: PsiManager, uri: String, start: Position): PsiElement? {
        val file = client.descriptor.findFileByUri(uri) ?: return null
        val psiFile = psiManager.findFile(file) ?: return null
        val document = FileDocumentManager.getInstance().getDocument(file) ?: return psiFile
        if (document.lineCount == 0) return psiFile
        val line = start.line.coerceIn(0, document.lineCount - 1)
        val offset = (document.getLineStartOffset(line) + start.character).coerceAtMost(document.getLineEndOffset(line))
        return psiFile.findElementAt(offset) ?: psiFile
    }

    private companion object {
        const val TIMEOUT_MS = 3000
    }
}
