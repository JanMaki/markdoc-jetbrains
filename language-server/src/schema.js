const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {Services} = require("@markdoc/language-server");

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/**
 * スキーマの読み込み。上流からの変更点：
 * - ESM を `file://` の URL で import する（上流は絶対パスを渡すので Windows で読めない）
 * - 失敗したら理由を通知する（上流は握りつぶす）
 */
class MarkdocSchema extends Services.Schema {
    constructor(config, connection) {
        super(config, connection);
        this.connection = connection;
    }

    async load() {
        const {schema, root} = this.config;
        if (!schema?.path) return;

        const absolute = path.resolve(root, schema.path);
        try {
            if (schema.type === "node") {
                delete require.cache[absolute];
                const value = require(absolute);
                return schema.property ? value[schema.property] : value;
            }
            const url = pathToFileURL(absolute);
            // 再読み込みで別のモジュールとして読ませる
            url.search = `t=${Date.now()}`;
            const value = await import(url.href);
            return value[schema.property ?? "default"];
        } catch (error) {
            this.report(absolute, error);
        }
    }

    /** 読めなかった理由を通知する。 */
    report(file, error) {
        const reason = error?.message ?? String(error);
        let message = `Markdoc: Failed to load the schema ${file}: ${reason}`;
        if (!fs.existsSync(file)) {
            message = `Markdoc: The schema ${file} does not exist. Check schema.path in the config file.`;
        } else if (TYPESCRIPT_EXTENSIONS.has(path.extname(file)) && !process.features?.typescript) {
            message += ` Node.js ${process.version} cannot load TypeScript files. Use Node.js 22.18, 23.6 or later,`
                + " or write the schema in JavaScript (for example markdoc.config.mjs).";
        } else if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") {
            message += " Install the project's dependencies (for example npm install) and restart the IDE.";
        }
        this.connection?.console.error(message);
        this.connection?.window.showErrorMessage(message);
    }
}

module.exports = {MarkdocSchema};
