const fs = require("node:fs/promises");
const {Plugins} = require("@markdoc/language-server");
const {partialResolver} = require("./partials");

/** 「Extract content to new partial」のコマンド。VS Code の拡張機能だけが実装している。 */
const EXTRACT_PARTIAL_COMMAND = "markdoc.extractPartial";

/**
 * Quick Fix。上流からの変更点：
 * - 「Inline contents of this partial」の partial を [partialResolver] で解決し、解決できなければ出さない
 *   （上流はコンテンツのディレクトリから読み、ENOENT で失敗する）
 * - JetBrains では動かない「Extract content to new partial」を出さない
 * - resolve が失敗したら、エラーを返さず元のアクションを返す
 */
class MarkdocCodeActionProvider extends Plugins.CodeActionProvider {
    findActions(ast, params) {
        const resolver = partialResolver(this.config, this.services);
        return super.findActions(ast, params).filter((action) => {
            if (action.command?.command === EXTRACT_PARTIAL_COMMAND) return false;
            if (action.data?.type !== "inlinePartial") return true;
            return Boolean(resolver.resolve(action.data.file, action.data.uri));
        });
    }

    async inlinePartial(uri, line, file) {
        const ast = this.services.Documents.ast(uri);
        if (!ast) return;
        const target = partialResolver(this.config, this.services).resolve(file, uri);
        if (!target) return;

        for (const node of ast.walk()) {
            if (node.tag === "partial" && node.lines[0] === line && !node.attributes.variables) {
                const newText = await fs.readFile(target, "utf8");
                const [start, end] = node.lines;
                const range = {start: {line: start, character: 0}, end: {line: end, character: 0}};
                return {changes: {[uri]: [{range, newText}]}};
            }
        }
    }

    async onCodeActionResolve(action) {
        try {
            return await super.onCodeActionResolve(action);
        } catch (error) {
            this.connection.console.warn(`Failed to resolve the code action "${action?.title}": ${error?.message ?? error}`);
            return action;
        }
    }
}

module.exports = {MarkdocCodeActionProvider};
