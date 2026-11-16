const {Plugins} = require("@markdoc/language-server");
const {partialResolver} = require("./partials");

/**
 * ドキュメントリンク。上流の partial のリンク（行き先は `Scanner.fullPath(file)`）を [partialResolver] で解決し直し、
 * 解決できない partial のリンクは出さない。
 */
class MarkdocLinkProvider extends Plugins.LinkProvider {
    onDocumentLinks(params) {
        const links = super.onDocumentLinks(params);
        const {uri} = params.textDocument;
        const ast = this.services.Documents.ast(uri);
        if (!ast || !Array.isArray(links)) return links;

        const {Scanner} = this.services;
        const partials = [];
        for (const node of ast.walk()) {
            const file = node.tag === "partial" ? node.attributes?.file : undefined;
            if (typeof file === "string") partials.push({file, line: node.lines?.[0]});
        }
        const resolver = partialResolver(this.config, this.services);
        return links.flatMap((link) => {
            const partial = partials.find(({file, line}) =>
                line === link.range.start.line && Scanner.fullPath(file) === link.target);
            if (!partial) return [link];
            const target = resolver.resolve(partial.file, uri);
            return target ? [{...link, target}] : [];
        });
    }
}

module.exports = {MarkdocLinkProvider};
