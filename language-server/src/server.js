// プラグインに同梱する言語サーバーのエントリーポイント。
// 上流の server() を起動し、JetBrains の LSP クライアント・Windows・Astro で問題になる部分を差し替える。
const {server, Services, Plugins} = require("@markdoc/language-server");
const {capabilities} = require("./capabilities");
const {CommentSafeDocuments, CommentSafeFormattingProvider} = require("./comments");
const {MarkdocCodeActionProvider} = require("./codeaction");
const {MarkdocCompletionProvider} = require("./completion");
const {MarkdocDefinitionProvider} = require("./definition");
const {MarkdocLinkProvider} = require("./link");
const {FsPathScanner} = require("./scanner");
const {MarkdocSchema} = require("./schema");
const {MarkdocValidationProvider} = require("./validation");

server(
    // TODO: Markdoc を更新して comments.js を消すときに、Documents と FormattingProvider を上流のものに戻す
    {...Services, Scanner: FsPathScanner, Documents: CommentSafeDocuments, Schema: MarkdocSchema},
    {
        ...Plugins,
        CodeActionProvider: MarkdocCodeActionProvider,
        CompletionProvider: MarkdocCompletionProvider,
        DefinitionProvider: MarkdocDefinitionProvider,
        LinkProvider: MarkdocLinkProvider,
        FormattingProvider: CommentSafeFormattingProvider,
        ValidationProvider: MarkdocValidationProvider,
    },
    capabilities,
);
