const {Plugins} = require("@markdoc/language-server");
const {partialResolver} = require("./partials");
const {frontmatterOf, withMarkdocVariables} = require("./variables");

/**
 * 検証。上流からの変更点：
 * - partial の有無を、起動時のスキャン結果ではなくディスク上のファイルで判定する（[partialResolver] で解決）。
 *   JetBrains ではファイル監視が届かず、上流は起動後に書いた partial を「見つからない」と報告する
 * - `$markdoc.frontmatter` と設定の `frontmatterVariable` を定義済みの変数にする
 * - 設定の `ignoreUndefinedVariables` が真なら「Undefined variable」を出さない（Astro もビルド時に無視する）
 */
class MarkdocValidationProvider extends Plugins.ValidationProvider {
    configuration(uri) {
        const config = super.configuration(uri);
        const {Documents, Scanner} = this.services;
        const ast = Documents.ast(uri);
        if (!ast) return config;

        // スキーマに variables がなければ上流は変数を検証しないので、そのままにする
        // （加えると、設定にない変数がすべて未定義と報告されるようになる）
        const variables = config.variables && typeof config.variables === "object"
            ? withMarkdocVariables(config.variables, frontmatterOf(ast, Scanner), this.config)
            : config.variables;

        const resolver = partialResolver(this.config, this.services);
        const partials = {...config.partials};
        for (const node of ast.walk()) {
            if (node.type !== "tag" || node.tag !== "partial") continue;
            const file = node.attributes?.file;
            if (typeof file !== "string" || !file) continue;
            if (resolver.resolve(file, uri)) partials[file] = true;
            else delete partials[file];
        }
        return {...config, partials, variables};
    }

    validate(uri) {
        const diagnostics = super.validate(uri);
        if (!diagnostics || !this.config.ignoreUndefinedVariables) return diagnostics;
        return diagnostics.filter((diagnostic) => diagnostic.code !== "variable-undefined");
    }
}

module.exports = {MarkdocValidationProvider};
